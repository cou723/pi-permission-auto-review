import { n as ScriptEvidenceStat } from "./review-context-CDC5-K_M.js";
import { Message, Usage } from "@earendil-works/pi-ai";
import { SessionEntry } from "@earendil-works/pi-coding-agent";
import { PromptPermissionDetails } from "@gotgenes/pi-permission-system";
declare const PRESET_NAMES: readonly ["codex", "claude-code"];
declare const REASONING_LEVELS: readonly ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
declare const FOLLOW_UP_REVIEW_MODES: readonly ["auto", "always", "off"];
/** Claude Code's own `autoMode` keys, so a block copied from its settings pastes in */
declare const RULE_LISTS: readonly ["environment", "allow", "soft_deny", "hard_deny"];
type PresetName = (typeof PRESET_NAMES)[number];
type ReasoningLevel = (typeof REASONING_LEVELS)[number];
type RuleListName = (typeof RULE_LISTS)[number];
interface FallbackConfig {
  provider: string;
  model: string;
  reasoning: ReasoningLevel;
  timeoutMs: number;
  cooldownMs: number;
}
interface AutoReviewConfig {
  $schema?: string | undefined;
  preset: PresetName;
  /** 上流の分類・閾値・例外を混ぜず、この本文だけで危険度と判定を決める */
  standalonePolicy?: string | undefined;
  provider: string;
  model: string;
  reasoning: ReasoningLevel;
  timeoutMs: number;
  maxRetries: number;
  attemptTimeoutMs?: number | undefined;
  followUpReviews: (typeof FOLLOW_UP_REVIEW_MODES)[number];
  /** 未設定と false は、切替なしの単一モデル動作 */
  fallback?: false | FallbackConfig | undefined;
  /** Each list still holds `DEFAULTS_ENTRY` where the preset's built-in entries belong */
  autoMode: Record<RuleListName, string[]>;
}
declare const DEFAULT_CONFIG: AutoReviewConfig;
type CallFailure = "input-budget-exceeded" | "provider-error" | "provider-refused" | "invalid-response" | "attempt-timeout" | "timeout" | "cancelled";
type CallUsage = Pick<Usage, "input" | "cacheRead" | "output">;
/** Where a review's transcript ended: an entry, and the tool call in it the review judged, if any */
interface TranscriptCursor {
  entryId: string;
  toolCallId?: string | undefined;
}
/** The reviews of a session so far, which a follow-up review continues with what the session added since */
interface ReviewConversation {
  /** Each review's prompts and the replies to them */
  messages: Message[];
  cursor: TranscriptCursor;
  tokens: number;
  reviews: number;
}
interface ContextFile {
  path: string;
  content: string;
}
/** Logged with the decision: never the reviewer's prose, and no key naming a token or an authorization, which the log masks */
type ReviewFields = Record<string, string | number | boolean | readonly ScriptEvidenceStat[]>;
type ReviewOutcome = {
  kind: "allow";
  fields: ReviewFields;
  conversation: ReviewConversation | undefined;
} | {
  kind: "deny";
  reason: string;
  fields: ReviewFields;
  conversation: ReviewConversation | undefined;
} | {
  kind: "defer";
  reason: string;
  fields: ReviewFields;
  conversation: ReviewConversation | undefined;
} | {
  kind: "failed";
  failure: CallFailure;
  fields: ReviewFields;
};
export { CallFailure as a, DEFAULT_CONFIG as c, TranscriptCursor as i, ReviewFields as n, CallUsage as o, ReviewOutcome as r, AutoReviewConfig as s, ContextFile as t };
//# sourceMappingURL=presets-BMhvqukm.d.ts.map