import { toJsonSchema } from '@valibot/to-json-schema'
import * as v from 'valibot'

export const EXTENSION_ID = 'pi-permission-auto-review'
export const CODEX_PROVIDER = 'openai-codex'
export const CODEX_AUTO_REVIEW_MODEL = 'codex-auto-review'
const MAX_TIMEOUT_MS = 300_000
export const CONFIG_SCHEMA_URL =
  'https://raw.githubusercontent.com/mzwing/pi-packages/master/packages/pi-permission-auto-review/schemas/config.schema.json'

export const PRESET_NAMES = ['codex', 'claude-code'] as const
export const REASONING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export const FOLLOW_UP_REVIEW_MODES = ['auto', 'always', 'off'] as const
/** Claude Code's own `autoMode` keys, so a block copied from its settings pastes in */
export const RULE_LISTS = ['environment', 'allow', 'soft_deny', 'hard_deny'] as const
/** Stands for the preset's built-in entries of a rule list, spliced in where it appears */
export const DEFAULTS_ENTRY = '$defaults'

export type PresetName = (typeof PRESET_NAMES)[number]
export type ReasoningLevel = (typeof REASONING_LEVELS)[number]
export type RuleListName = (typeof RULE_LISTS)[number]

export const PRESET_DEFAULTS: Readonly<
  Record<PresetName, { provider: string; model: string; reasoning: ReasoningLevel }>
> = {
  codex: { provider: CODEX_PROVIDER, model: CODEX_AUTO_REVIEW_MODEL, reasoning: 'low' },
  // Used by the second pass alone, at Sonnet's own default effort
  'claude-code': { provider: 'anthropic', model: 'claude-sonnet-5', reasoning: 'high' },
}

const nonBlankSchema = v.pipe(v.string(), v.trim(), v.minLength(1))
const timeoutSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(MAX_TIMEOUT_MS))
const maxRetriesSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(20))
const rulesSchema = v.array(nonBlankSchema)
const builtInRulesSchema = v.optional(rulesSchema, () => [DEFAULTS_ENTRY])
// 会話に使っているモデルと同じ提供元（同じサブスクリプションの枠）で審査するための対応表。
// 審査のたびに先頭から照合し、どれにも一致しなければ provider / model を使う。
const routeSchema = v.strictObject({
  conversationProviders: v.pipe(v.array(nonBlankSchema), v.minLength(1)),
  provider: nonBlankSchema,
  model: nonBlankSchema,
  reasoning: v.optional(v.picklist(REASONING_LEVELS)),
  timeoutMs: v.optional(timeoutSchema),
})

const fileSchema = v.strictObject({
  $schema: v.optional(v.pipe(v.string(), v.minLength(1))),
  preset: v.optional(v.picklist(PRESET_NAMES)),
  standalonePolicy: v.optional(
    v.pipe(
      nonBlankSchema,
      v.description('codex の既定の分類・閾値を使わない独立ポリシー。claude-code プリセットや autoMode と混在不可。'),
    ),
  ),
  provider: v.optional(nonBlankSchema),
  model: v.optional(nonBlankSchema),
  reasoning: v.optional(v.picklist(REASONING_LEVELS)),
  timeoutMs: v.optional(timeoutSchema),
  maxRetries: v.optional(maxRetriesSchema),
  attemptTimeoutMs: v.optional(timeoutSchema),
  followUpReviews: v.optional(v.picklist(FOLLOW_UP_REVIEW_MODES)),
  routes: v.optional(v.array(routeSchema)),
  autoMode: v.optional(
    v.strictObject({
      environment: v.optional(rulesSchema),
      allow: v.optional(rulesSchema),
      soft_deny: v.optional(rulesSchema),
      hard_deny: v.optional(rulesSchema),
    }),
  ),
})

const configSchema = v.pipe(
  v.strictObject({
    ...fileSchema.entries,
    preset: v.optional(v.picklist(PRESET_NAMES), 'codex'),
    timeoutMs: v.optional(timeoutSchema, 90_000),
    maxRetries: v.optional(maxRetriesSchema, 2),
    followUpReviews: v.optional(v.picklist(FOLLOW_UP_REVIEW_MODES), 'auto'),
    autoMode: v.optional(
      v.strictObject({
        environment: builtInRulesSchema,
        allow: builtInRulesSchema,
        soft_deny: builtInRulesSchema,
        hard_deny: builtInRulesSchema,
      }),
      {},
    ),
  }),
  // The published JSON Schema stops before this step, so these fields list no default there
  v.transform(config => ({
    ...config,
    provider: config.provider ?? PRESET_DEFAULTS[config.preset].provider,
    model: config.model ?? PRESET_DEFAULTS[config.preset].model,
    reasoning: config.reasoning ?? PRESET_DEFAULTS[config.preset].reasoning,
  })),
)

export interface ReviewRoute {
  /** 会話のモデルの提供元。どれかに一致したら、この対応を使う */
  conversationProviders: string[]
  provider: string
  /** `*` を含む場合は、利用可能なモデルから一致する最新の版を選ぶ */
  model: string
  /** 省略時は最上位の reasoning / timeoutMs */
  reasoning?: ReasoningLevel | undefined
  timeoutMs?: number | undefined
}

// `isolatedDeclarations` cannot emit a `v.InferOutput` of a private schema; `DEFAULT_CONFIG` keeps the two in step
export interface AutoReviewConfig {
  $schema?: string | undefined
  preset: PresetName
  /** 上流の分類・閾値・例外を混ぜず、この本文だけで危険度と判定を決める */
  standalonePolicy?: string | undefined
  provider: string
  model: string
  reasoning: ReasoningLevel
  timeoutMs: number
  maxRetries: number
  attemptTimeoutMs?: number | undefined
  followUpReviews: (typeof FOLLOW_UP_REVIEW_MODES)[number]
  /** 会話の提供元ごとの審査モデル。一致しなければ provider / model */
  routes?: ReviewRoute[] | undefined
  /** Each list still holds `DEFAULTS_ENTRY` where the preset's built-in entries belong */
  autoMode: Record<RuleListName, string[]>
}

export type AutoReviewConfigFile = {
  [K in Exclude<keyof AutoReviewConfig, 'autoMode'>]?: AutoReviewConfig[K] | undefined
} & { autoMode?: { [L in RuleListName]?: string[] | undefined } | undefined }

export const DEFAULT_CONFIG: AutoReviewConfig = v.parse(configSchema, {})

export type ParseResult<T> = { ok: true; config: T } | { ok: false; issue: string }

function formatIssues(issues: v.BaseIssue<unknown>[]): string {
  return issues.map(issue => `${v.getDotPath(issue) ?? '(root)'}: ${issue.message}`).join('; ')
}

const STANDALONE_CONFLICT = 'standalonePolicy requires the codex preset without autoMode rules'

/** 独立ポリシーと別プリセット・分類別ルールの混在は、暗黙の無視ではなく設定エラーにする */
function standaloneConflict(config: AutoReviewConfigFile): string | undefined {
  if (config.standalonePolicy === undefined) {
    return undefined
  }

  return config.preset === 'claude-code' || Object.keys(config.autoMode ?? {}).length > 0
    ? STANDALONE_CONFLICT
    : undefined
}

export function validateConfigFile(value: unknown): ParseResult<AutoReviewConfigFile> {
  const parsed = v.safeParse(fileSchema, value)
  if (!parsed.success) {
    return { ok: false, issue: formatIssues(parsed.issues) }
  }
  const conflict = standaloneConflict(parsed.output)

  return conflict === undefined ? { ok: true, config: parsed.output } : { ok: false, issue: conflict }
}

export function parseConfigFile(source: string): ParseResult<AutoReviewConfigFile> {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error) {
    return { ok: false, issue: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` }
  }

  return validateConfigFile(value)
}

/** Project fields override global ones, and a project rule list the global list of its name */
export function mergeConfig(global: AutoReviewConfigFile, project: AutoReviewConfigFile): AutoReviewConfig {
  const merged = { ...global, ...project, autoMode: { ...global.autoMode, ...project.autoMode } }
  // それぞれは妥当でも、組み合わせると混在になり得る（例：グローバルの独立ポリシー＋プロジェクトの autoMode）
  const conflict = standaloneConflict(merged)
  if (conflict !== undefined) {
    throw new Error(conflict)
  }

  return v.parse(configSchema, merged)
}

export function buildJsonSchema(): Record<string, unknown> {
  const { $schema, ...schema } = toJsonSchema(configSchema, {
    target: 'draft-2020-12',
    typeMode: 'input',
    ignoreActions: ['trim'],
  })

  return {
    $schema,
    $id: CONFIG_SCHEMA_URL,
    ...schema,
    // valibot からは出せない項目間の制約。standaloneConflict と同じ条件をエディターへ伝える
    allOf: [
      {
        if: { required: ['standalonePolicy'] },
        then: { properties: { preset: { const: 'codex' }, autoMode: { maxProperties: 0 } } },
      },
    ],
  }
}
