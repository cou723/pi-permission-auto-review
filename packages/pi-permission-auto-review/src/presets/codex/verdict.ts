import * as v from 'valibot'

const assessmentPayloadSchema = v.strictObject({
  risk_level: v.optional(v.picklist(['low', 'medium', 'high', 'critical'])),
  user_authorization: v.optional(v.picklist(['unknown', 'low', 'medium', 'high'])),
  // ask: 対象・作用・必要な承認の証拠が不足し、人の確認に委ねる
  outcome: v.picklist(['allow', 'deny', 'ask']),
  rationale: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(4_000))),
})

type RiskLevel = 'low' | 'medium' | 'high' | 'critical'
type UserAuthorization = 'unknown' | 'low' | 'medium' | 'high'

export interface ReviewAssessment {
  riskLevel: RiskLevel
  userAuthorization: UserAuthorization
  outcome: 'allow' | 'deny' | 'ask'
  rationale: string
}

function parseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) {
      throw new Error('review response was not valid JSON')
    }
    return JSON.parse(text.slice(start, end + 1))
  }
}

export function parseReviewAssessment(text: string): ReviewAssessment {
  const payload = v.parse(assessmentPayloadSchema, parseJsonObject(text))
  const riskLevel =
    payload.risk_level ?? (payload.outcome === 'allow' ? 'low' : payload.outcome === 'ask' ? 'medium' : 'high')
  const rationale =
    payload.rationale ??
    (payload.outcome === 'allow'
      ? 'Automatic review returned a low-risk allow decision.'
      : 'The review returned no rationale.')

  return {
    riskLevel,
    userAuthorization: payload.user_authorization ?? 'unknown',
    outcome: payload.outcome,
    rationale,
  }
}
