import type { AutoReviewConfig } from '../config/config.js'
import type { ContextFile, Preset, ReviewFields, ReviewOutcome } from '../presets/presets.js'
import type { ReviewConversation } from './conversation.js'
import type { CallFailure, CallUsage } from './model-call.js'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { Authorizer, AuthorizerVerdict, PromptPermissionDetails } from '@gotgenes/pi-permission-system'
import { PRESETS } from '../presets/presets.js'
import { findToolCallInput } from '../presets/session.js'
import { createModelCall } from './model-call.js'
import { resolveReviewModel } from './model.js'
import { collectScriptEvidence, confirmationNotice, failureNotice } from './review-context.js'
import { createReviewRouter } from './review-router.js'
import { isSafeGitRead, safeGitReadCandidate } from './safe-git-read.js'

const DECISION_EVENT = 'auto_review.decision'

type FailureCategory = 'provider-unresolved' | 'model-unresolved' | CallFailure

export interface ReviewerRuntime {
  config: AutoReviewConfig
  /** Read at every review, since `signal` belongs to the turn in progress */
  context: Pick<ExtensionContext, 'modelRegistry' | 'sessionManager' | 'signal' | 'cwd' | 'hasUI' | 'ui'>
  /** 同じセッションで実行中のツールから、入れ子を含む引数全体を取り出す。取得できなければ undefined */
  getToolInput?: ((details: PromptPermissionDetails) => unknown) | undefined
  /** The context files the user's trust covers, as of the latest run */
  contextFiles: () => readonly ContextFile[]
  /** Aborted when the reviewer is replaced or the session ends */
  sessionSignal: AbortSignal
}

export interface PermissionReviewer {
  authorize: Authorizer['authorize']
  /** Clears the denials the preset counts per turn */
  resetTurn: () => void
}

export type ReviewResult =
  | (Exclude<ReviewOutcome, { kind: 'failed' }> & { usage: CallUsage })
  | { kind: 'failed'; failure: FailureCategory; fields?: ReviewFields; usage?: CallUsage }

async function runReview(
  runtime: ReviewerRuntime,
  preset: Preset,
  details: PromptPermissionDetails,
  conversation: ReviewConversation | undefined,
): Promise<ReviewResult> {
  const { config, context } = runtime
  const deadline = Date.now() + config.timeoutMs
  const timeoutController = new AbortController()
  const timeout = setTimeout(() => timeoutController.abort(), config.timeoutMs)
  const turnSignal = context.signal
  const signal = AbortSignal.any([
    timeoutController.signal,
    runtime.sessionSignal,
    ...(turnSignal === undefined ? [] : [turnSignal]),
  ])

  try {
    if (signal.aborted) {
      return { kind: 'failed', failure: 'cancelled' }
    }
    const resolved = resolveReviewModel(context.modelRegistry, config)
    if (!resolved.ok) {
      return { kind: 'failed', failure: resolved.category }
    }
    const model = resolved.value
    const usage = { input: 0, cacheRead: 0, output: 0 }
    const complete = createModelCall({
      registry: context.modelRegistry,
      model,
      config,
      sessionId: context.sessionManager.getSessionId(),
      signal,
      timeoutSignal: timeoutController.signal,
      deadline,
      usage,
    })
    const branch = context.sessionManager.getBranch()
    const toolInput = runtime.getToolInput?.(details)
    // 分類器はツールを持たないため、実行されるスクリプトの中身を審査の前に読み出して渡す
    const scriptEvidence = await collectScriptEvidence(
      details,
      toolInput ?? findToolCallInput(branch, details.toolCallId),
      context.cwd,
    )
    const outcome = await preset.review(
      {
        config,
        branch,
        details,
        toolInput,
        scriptEvidence,
        contextFiles: runtime.contextFiles(),
        conversation,
        contextWindow: model.contextWindow,
      },
      complete,
    )

    return { ...outcome, usage }
  } finally {
    clearTimeout(timeout)
  }
}

export function createPermissionReviewer(runtime: ReviewerRuntime): PermissionReviewer {
  const { config } = runtime
  const preset = PRESETS[config.preset]
  // Per reviewer, so a retired one finishing a review late cannot trip its successor
  const limiter = preset.createLimiter()
  // As upstream keeps it: concurrent reviews each continue the conversation they started from, and the last to finish wins
  let conversation: ReviewConversation | undefined
  // 切替時は会話を共有せず、別プロバイダーへ過去の回答を持ち込まない
  const review = createReviewRouter(runtime, async (attemptRuntime, details) =>
    runReview(
      attemptRuntime,
      preset,
      details,
      config.fallback === undefined || config.fallback === false ? conversation : undefined,
    ),
  )

  const authorize: Authorizer['authorize'] = async (details, _query, log) => {
    const startedAt = Date.now()
    const entryBase = { requestId: details.requestId, provider: config.provider, model: config.model }
    const elapsed = (): number => Math.max(0, Date.now() - startedAt)
    const logFailure = (entry: Record<string, unknown>): void => {
      log.review(DECISION_EVENT, entry)
      log.debug('auto_review.failure', entry)
    }

    try {
      const refusal = limiter.refusal()
      if (refusal !== undefined) {
        log.review('auto_review.circuit_open', {
          ...entryBase,
          outcome: 'deny',
          durationMs: 0,
          errorCategory: 'circuit-open',
        })

        return { kind: 'deny', reason: refusal }
      }

      const toolInput = runtime.getToolInput?.(details)
      // Git の起動を待つのは候補だけ。それ以外の要求は上流と同じ時点で審査を始める
      const gitSignal = AbortSignal.any([
        runtime.sessionSignal,
        ...(runtime.context.signal === undefined ? [] : [runtime.context.signal]),
      ])
      if (
        safeGitReadCandidate(details, toolInput) !== undefined &&
        (await isSafeGitRead(details, toolInput, runtime.context, gitSignal)) &&
        !gitSignal.aborted
      ) {
        limiter.recordNonDenial()
        // decisionSource は、モデルを呼ばずに許可したことを示す
        log.review(DECISION_EVENT, {
          ...entryBase,
          outcome: 'allow',
          decisionSource: 'safe-git-read',
          durationMs: elapsed(),
        })

        return { kind: 'allow' }
      }

      const result = await review(details)
      const durationMs = elapsed()
      const diagnostics = {
        policyRevision: preset.policyRevision,
        contextSource: 'active-branch',
        ...result.fields,
        ...result.diagnostics,
        ...(result.usage === undefined ? {} : { usage: result.usage }),
      }
      if (result.kind === 'failed') {
        // The conversation may be what failed, such as one too long for the provider; an interruption says nothing of it
        if (result.failure !== 'cancelled') {
          conversation = undefined
        }
        // Deferring would open the human prompt the user just escaped, and Pi drops an interrupted call's verdict anyway
        const verdict: AuthorizerVerdict =
          result.failure === 'cancelled'
            ? { kind: 'deny', reason: 'The automatic review was cancelled before it finished' }
            : { kind: 'defer' }
        // 以前は通知なしで確認画面だけが出ていた。自動審査を完了できなかった理由を日本語で伝える
        if (verdict.kind === 'defer' && runtime.context.hasUI) {
          runtime.context.ui.notify(failureNotice(result.failure), 'warning')
        }
        limiter.recordNonDenial()
        logFailure({ ...entryBase, outcome: verdict.kind, errorCategory: result.failure, durationMs, ...diagnostics })

        return verdict
      }

      conversation = result.conversation
      if (result.kind === 'defer') {
        // ask は拒否回数に加算せず、別モデルでも再審査しない
        limiter.recordNonDenial()
        log.review(DECISION_EVENT, { ...entryBase, outcome: 'defer', durationMs, ...diagnostics })
        if (runtime.context.hasUI) {
          runtime.context.ui.notify(confirmationNotice(result.reason), 'info')
        }

        return { kind: 'defer' }
      }
      if (result.kind === 'allow') {
        limiter.recordNonDenial()
        log.review(DECISION_EVENT, { ...entryBase, outcome: 'allow', durationMs, ...diagnostics })

        return { kind: 'allow' }
      }
      const denialLimit = limiter.recordDenial()
      if (denialLimit !== undefined) {
        log.review(DECISION_EVENT, { ...entryBase, outcome: 'defer', denialLimit, durationMs, ...diagnostics })

        return { kind: 'defer' }
      }
      log.review(DECISION_EVENT, { ...entryBase, outcome: 'deny', durationMs, ...diagnostics })

      return { kind: 'deny', reason: result.reason }
    } catch {
      // The chain does not isolate a link that throws, so every internal failure has to leave as a verdict
      conversation = undefined
      limiter.recordNonDenial()
      logFailure({ ...entryBase, outcome: 'defer', errorCategory: 'internal-error', durationMs: elapsed() })
      if (runtime.context.hasUI) {
        runtime.context.ui.notify(failureNotice('internal-error'), 'warning')
      }

      return { kind: 'defer' }
    }
  }

  return { authorize, resetTurn: () => limiter.resetTurn() }
}
