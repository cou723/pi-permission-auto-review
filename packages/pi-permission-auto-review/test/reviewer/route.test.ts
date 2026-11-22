import type { ModelRegistry } from '@earendil-works/pi-coding-agent'
import { afterEach, expect, it, vi } from 'vitest'
import { mergeConfig, validateConfigFile } from '../../src/config/config.js'
import { resolveReviewModel } from '../../src/reviewer/model.js'
import { selectReviewTarget } from '../../src/reviewer/route.js'
import { createReviewerHarness, reply } from '../helpers.js'

afterEach(() => {
  vi.useRealTimers()
})

const config = mergeConfig(
  {},
  {
    provider: 'strata',
    model: 'swift-1.5-iq3_xxs',
    reasoning: 'medium',
    timeoutMs: 240_000,
    routes: [
      { conversationProviders: ['openai'], provider: 'openai', model: '*-luna', reasoning: 'high', timeoutMs: 60_000 },
      { conversationProviders: ['claude-bridge', 'anthropic'], provider: 'claude-bridge', model: 'claude-haiku-*' },
    ],
  },
)

it('reviews in the same provider as the conversation, and falls back to the top-level model otherwise', () => {
  expect(selectReviewTarget(config, 'openai')).toMatchObject({
    provider: 'openai',
    model: '*-luna',
    reasoning: 'high',
    timeoutMs: 60_000,
  })
  // reasoning / timeoutMs を省いた対応は最上位の値を使う
  expect(selectReviewTarget(config, 'anthropic')).toMatchObject({
    provider: 'claude-bridge',
    model: 'claude-haiku-*',
    reasoning: 'medium',
    timeoutMs: 240_000,
  })
  for (const provider of ['strata', 'local', undefined]) {
    expect(selectReviewTarget(config, provider)).toMatchObject({ provider: 'strata', model: 'swift-1.5-iq3_xxs' })
  }
})

it('rejects a route without conversation providers, and the removed fallback field', () => {
  expect(validateConfigFile({ routes: [{ conversationProviders: [], provider: 'openai', model: 'x' }] }).ok).toBe(false)
  expect(validateConfigFile({ fallback: false }).ok).toBe(false)
})

it('resolves a wildcard model to the latest available version of that provider only', () => {
  const available = [
    ['claude-bridge', 'claude-haiku-4-5'],
    ['claude-bridge', 'claude-haiku-5-5'],
    ['anthropic', 'claude-haiku-6-0'],
    ['openai', 'gpt-5.6-luna'],
    ['openai', 'gpt-6-luna'],
    ['openai', 'gpt-6-luna-preview'],
  ].map(([provider, id]) => ({ provider, id }))
  const registry = {
    getProvider: (id: string) => ({ id }),
    getAvailable: () => available,
    find: () => undefined,
  } as unknown as ModelRegistry
  const resolve = (provider: string, model: string) => {
    const result = resolveReviewModel(registry, { ...config, provider, model })

    return result.ok ? result.value.id : result.category
  }

  expect(resolve('claude-bridge', 'claude-haiku-*')).toBe('claude-haiku-5-5')
  expect(resolve('openai', '*-luna')).toBe('gpt-6-luna')
  expect(resolve('openai', '*-terra')).toBe('model-unresolved')
})

it('logs the conversation provider and the model the review actually used', async () => {
  vi.useFakeTimers({ now: 0 })
  const harness = createReviewerHarness({
    replies: [reply('{"outcome":"allow"}')],
    config: { routes: [{ conversationProviders: ['openai'], provider: 'custom-review', model: 'routed-model' }] },
    conversationProvider: 'openai',
  })
  // 審査はタイムアウト用のタイマーを持つため、偽のタイマーで最後まで進める
  const { verdict, entries } = await harness.authorize()

  expect(verdict).toEqual({ kind: 'allow' })
  expect(entries[0]?.[1]).toMatchObject({
    provider: 'custom-review',
    model: 'routed-model',
    modelId: 'review-model',
    conversationProvider: 'openai',
  })
})

it('logs the resolved model ID alongside the wildcard model pattern', async () => {
  vi.useFakeTimers({ now: 0 })
  const available = [
    { provider: 'openai', id: 'gpt-5.6-luna', api: 'openai-responses', reasoning: true, contextWindow: 200_000 },
    { provider: 'openai', id: 'gpt-6-luna', api: 'openai-responses', reasoning: true, contextWindow: 200_000 },
  ] as const
  const harness = createReviewerHarness({
    replies: [reply('{"outcome":"allow"}')],
    config: { routes: [{ conversationProviders: ['openai'], provider: 'openai', model: '*-luna' }] },
    conversationProvider: 'openai',
    availableModels: available as never,
    getProvider: () => ({ id: 'openai' }),
  })
  const { verdict, entries } = await harness.authorize()

  expect(verdict).toEqual({ kind: 'allow' })
  expect(entries[0]?.[1]).toMatchObject({
    provider: 'openai',
    model: '*-luna',
    modelId: 'gpt-6-luna',
    conversationProvider: 'openai',
  })
})
