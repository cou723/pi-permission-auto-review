import type { AutoReviewConfig } from '../config/config.js'

/**
 * 会話のモデルの提供元から、この審査に使う設定を決める。
 * 会話と同じサブスクリプションの枠で審査するため、モデルを途中で切り替えても審査のたびに選び直す。
 * 一致する対応がなければ最上位の provider / model を使う。使えないモデルへの切替（フォールバック）はしない。
 */
export function selectReviewTarget(
  config: AutoReviewConfig,
  conversationProvider: string | undefined,
): AutoReviewConfig {
  const route =
    conversationProvider === undefined
      ? undefined
      : config.routes?.find(candidate => candidate.conversationProviders.includes(conversationProvider))
  if (route === undefined) {
    return config
  }

  return {
    ...config,
    provider: route.provider,
    model: route.model,
    reasoning: route.reasoning ?? config.reasoning,
    timeoutMs: route.timeoutMs ?? config.timeoutMs,
  }
}
