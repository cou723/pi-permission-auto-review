import type { AutoReviewConfig } from '../config/config.js'
import type { ReviewerRuntime, ReviewResult } from './reviewer.js'
import type { PromptPermissionDetails } from '@gotgenes/pi-permission-system'

// 判定そのものではなく、モデルの利用不能だけを切替の対象にする。
// 正常な allow / deny や、プロバイダーの明示的な拒否（provider-refused）は対象外。
const UNAVAILABLE: ReadonlySet<string> = new Set([
  'provider-unresolved',
  'model-unresolved',
  'provider-error',
  'timeout',
  'attempt-timeout',
])

export interface ReviewAttempt {
  provider: string
  model: string
  outcome: string
  durationMs: number
}

/** 実際に使ったモデルと試行の経過。審査ログに載せる */
export interface RouteDiagnostics {
  provider: string
  model: string
  reviewAttempts: ReviewAttempt[]
  fallbackReason?: string | undefined
}

export type RoutedResult = ReviewResult & { diagnostics?: RouteDiagnostics | undefined }

export type RunReview = (runtime: ReviewerRuntime, details: PromptPermissionDetails) => Promise<ReviewResult>

export type ReviewRouter = (details: PromptPermissionDetails) => Promise<RoutedResult>

/**
 * 優先モデルで審査し、利用できない場合だけ fallback のモデルで同じ操作を審査する。
 * 障害後は cooldownMs の間、切替先を直接使い、経過後の審査で優先モデルの復旧を確かめる。
 */
export function createReviewRouter(runtime: ReviewerRuntime, runReview: RunReview): ReviewRouter {
  const { config } = runtime
  // false と未設定は、どちらも切替なし
  const fallback = config.fallback === false ? undefined : config.fallback
  let retryAfter = 0
  let probing = false
  const cancelled = (): boolean => runtime.sessionSignal.aborted || runtime.context.signal?.aborted === true
  const cancelledResult = (): RoutedResult => ({ kind: 'failed', failure: 'cancelled' })

  return async details => {
    const attempts: ReviewAttempt[] = []
    let fallbackReason: string | undefined

    const attempt = async (target: AutoReviewConfig, primary: boolean): Promise<RoutedResult> => {
      const started = Date.now()
      let result: ReviewResult
      try {
        result = await runReview(
          {
            ...runtime,
            // 自動切替時は上流の再試行設定で各モデルを1回に限定し、レビュー履歴も共有しない
            config: fallback === undefined ? target : { ...target, maxRetries: 0, followUpReviews: 'off' },
          },
          details,
        )
      } catch (error) {
        if (!cancelled()) {
          throw error
        }
        result = { kind: 'failed', failure: 'cancelled' }
      }
      // 成功応答と競合しても、キャンセル済みなら失敗として扱う
      if (cancelled()) {
        result = {
          kind: 'failed',
          failure: 'cancelled',
          ...(result.fields === undefined ? {} : { fields: result.fields }),
          ...(result.usage === undefined ? {} : { usage: result.usage }),
        }
      }
      attempts.push({
        provider: target.provider,
        model: target.model,
        outcome: result.kind === 'failed' ? result.failure : result.kind,
        durationMs: Math.max(0, Date.now() - started),
      })

      return {
        ...result,
        diagnostics: {
          provider: target.provider,
          model: target.model,
          reviewAttempts: [...attempts],
          ...(primary ? {} : { fallbackReason }),
        },
      }
    }

    if (cancelled()) {
      return cancelledResult()
    }
    if (fallback === undefined) {
      return attempt(config, true)
    }

    if (Date.now() < retryAfter || probing) {
      fallbackReason = probing ? 'recovery-probe-in-flight' : 'primary-cooldown'
    } else {
      const recovery = retryAfter > 0
      if (recovery) {
        probing = true
      }
      try {
        const result = await attempt(config, true)
        if (result.kind !== 'failed' || !UNAVAILABLE.has(result.failure)) {
          // 正常な拒否も「モデルは利用可能」。別モデルで判定を覆さない
          if (result.kind !== 'failed') {
            retryAfter = 0
          }

          return result
        }
        retryAfter = Date.now() + fallback.cooldownMs
        fallbackReason = result.failure
      } finally {
        if (recovery) {
          probing = false
        }
      }
    }
    // キャンセルや世代交代の後に、別プロバイダーへの送信を始めない
    if (cancelled()) {
      return cancelledResult()
    }

    return attempt({ ...config, ...fallback, fallback: false }, false)
  }
}
