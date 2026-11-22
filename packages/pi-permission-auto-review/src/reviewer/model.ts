import type { AutoReviewConfig } from '../config/config.js'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { ModelRegistry } from '@earendil-works/pi-coding-agent'
import { CODEX_AUTO_REVIEW_MODEL, CODEX_PROVIDER } from '../config/config.js'

export type ResolveReviewModelResult =
  | { ok: true; value: Model<Api> }
  | { ok: false; category: 'provider-unresolved' | 'model-unresolved' }

const CODEX_API = 'openai-codex-responses'

/** ID 中の数字列を版として比較する（claude-haiku-5-5 > claude-haiku-4-5、gpt-6-luna > gpt-5.6-luna） */
function compareVersionsDescending(a: string, b: string): number {
  const version = (id: string): number[] => (id.match(/\d+/g) ?? []).map(Number)
  const [x, y] = [version(a), version(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (y[i] ?? -1) - (x[i] ?? -1)
    if (diff !== 0) {
      return diff
    }
  }

  return 0
}

function globPattern(glob: string): RegExp {
  const source = glob
    .split('*')
    .map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')

  return new RegExp(`^${source}$`)
}

/**
 * `*` を含む ID は、認証済みで利用可能なモデルから一致する最新の版を選ぶ。
 * 世代が更新されるたびに設定を書き直さなくて済むようにするため。
 */
function findLatestAvailable(registry: ModelRegistry, provider: string, glob: string): Model<Api> | undefined {
  const pattern = globPattern(glob)

  return registry
    .getAvailable()
    .filter(model => model.provider === provider && pattern.test(model.id))
    .sort((a, b) => compareVersionsDescending(a.id, b.id))[0]
}

/** `codex-auto-review` is hidden from the registry, so it is derived from another model of the Codex provider */
export function resolveReviewModel(registry: ModelRegistry, config: AutoReviewConfig): ResolveReviewModelResult {
  const provider = registry.getProvider(config.provider)
  if (provider === undefined) {
    return { ok: false, category: 'provider-unresolved' }
  }
  const registered = config.model.includes('*')
    ? findLatestAvailable(registry, config.provider, config.model)
    : registry.find(config.provider, config.model)
  if (registered !== undefined) {
    return { ok: true, value: registered }
  }
  if (config.provider !== CODEX_PROVIDER || config.model !== CODEX_AUTO_REVIEW_MODEL) {
    return { ok: false, category: 'model-unresolved' }
  }

  const template =
    registry.getAll().find(model => model.provider === CODEX_PROVIDER && model.api === CODEX_API) ??
    provider.getModels().find(model => model.api === CODEX_API)

  return template === undefined
    ? { ok: false, category: 'model-unresolved' }
    : {
        ok: true,
        value: {
          ...template,
          id: CODEX_AUTO_REVIEW_MODEL,
          name: 'Codex Auto Review',
          reasoning: true,
          input: ['text'],
        },
      }
}
