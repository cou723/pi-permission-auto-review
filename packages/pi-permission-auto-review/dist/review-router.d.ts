import { a as CallFailure, n as ReviewFields, o as CallUsage, r as ReviewOutcome, s as AutoReviewConfig, t as ContextFile } from "./presets-BMhvqukm.js";
import { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { PromptPermissionDetails } from "@gotgenes/pi-permission-system";
type FailureCategory = "provider-unresolved" | "model-unresolved" | CallFailure;
interface ReviewerRuntime {
  config: AutoReviewConfig;
  /** Read at every review, since `signal` belongs to the turn in progress */
  context: Pick<ExtensionContext, "modelRegistry" | "sessionManager" | "signal" | "cwd" | "hasUI" | "ui">;
  /** 同じセッションで実行中のツールから、入れ子を含む引数全体を取り出す。取得できなければ undefined */
  getToolInput?: ((details: PromptPermissionDetails) => unknown) | undefined;
  /** The context files the user's trust covers, as of the latest run */
  contextFiles: () => readonly ContextFile[];
  /** Aborted when the reviewer is replaced or the session ends */
  sessionSignal: AbortSignal;
}
type ReviewResult = (Exclude<ReviewOutcome, {
  kind: "failed";
}> & {
  usage: CallUsage;
}) | {
  kind: "failed";
  failure: FailureCategory;
  fields?: ReviewFields;
  usage?: CallUsage;
};
export interface ReviewAttempt {
  provider: string;
  model: string;
  outcome: string;
  durationMs: number;
}
/** 実際に使ったモデルと試行の経過。審査ログに載せる */
export interface RouteDiagnostics {
  provider: string;
  model: string;
  reviewAttempts: ReviewAttempt[];
  fallbackReason?: string | undefined;
}
export type RoutedResult = ReviewResult & {
  diagnostics?: RouteDiagnostics | undefined;
};
export type RunReview = (runtime: ReviewerRuntime, details: PromptPermissionDetails) => Promise<ReviewResult>;
export type ReviewRouter = (details: PromptPermissionDetails) => Promise<RoutedResult>;
/**
 * 優先モデルで審査し、利用できない場合だけ fallback のモデルで同じ操作を審査する。
 * 障害後は cooldownMs の間、切替先を直接使い、経過後の審査で優先モデルの復旧を確かめる。
 */
export declare function createReviewRouter(runtime: ReviewerRuntime, runReview: RunReview): ReviewRouter;
export {};
//# sourceMappingURL=review-router.d.ts.map