import { c as DEFAULT_CONFIG, i as TranscriptCursor, s as AutoReviewConfig, t as ContextFile } from "./presets-BMhvqukm.js";
import { SessionEntry } from "@earendil-works/pi-coding-agent";
import { PromptPermissionDetails } from "@gotgenes/pi-permission-system";
declare const POLICY_REVISION$1: string;
export declare const FIXED_REVIEW_PROTOCOL: string;
declare function buildSystemPrompt$1(config: AutoReviewConfig, contextFiles?: readonly ContextFile[]): string;
interface TranscriptStats {
  transcriptEntriesRetained: number;
  transcriptEntriesOmitted: number;
  transcriptEntriesTruncated: number;
  directUserEntriesRetained: number;
  directUserEntriesOmitted: number;
  directUserEntriesTruncated: number;
  userInteractionEntriesRetained: number;
  userInteractionEntriesOmitted: number;
  userInteractionEntriesTruncated: number;
  latestTrustedEntryRetained: boolean;
}
interface RenderedTranscript {
  entries: string[];
  stats: TranscriptStats;
}
/**
 * Keeps the first and latest trusted records unconditionally, then other trusted records newest first, then the
 * newest untrusted ones; the untrusted cap never evicts an authorization that was already selected. A follow-up
 * review sees only the entries from `from` on, which still count an answer to a question asked before them
 */
declare function renderTranscript$1(sessionEntries: SessionEntry[], from?: number): RenderedTranscript;
interface ReviewPrompt {
  systemPrompt: string;
  userPrompt: string;
}
export declare function buildReviewPrompt(config: AutoReviewConfig, transcript: RenderedTranscript, details: PromptPermissionDetails, toolInput?: unknown): ReviewPrompt;
/** The complete arguments of the assistant tool call that raised an ask, which the ask itself only previews */
export declare function findToolCallInput(entries: SessionEntry[], toolCallId: string | undefined): unknown;
type RiskLevel = "low" | "medium" | "high" | "critical";
type UserAuthorization = "unknown" | "low" | "medium" | "high";
interface ReviewAssessment {
  riskLevel: RiskLevel;
  userAuthorization: UserAuthorization;
  outcome: "allow" | "deny" | "ask";
  rationale: string;
}
export declare function parseReviewAssessment(text: string): ReviewAssessment;
interface ClaudeCodeTranscript {
  /** JSONL lines, the action under review last */
  lines: string[];
  /** Where this rendering ended, which a follow-up continues after */
  cursor: TranscriptCursor | undefined;
  stats: {
    transcriptLinesRetained: number;
    transcriptLinesOmitted: number;
    transcriptLinesTruncated: number;
  };
}
/**
 * The branch up to the call that raised the ask, which is always the last line; with `after`, only what follows
 * that cursor. A user line always brings the agent prose it answers, even from before the cursor
 */
declare function renderTranscript(entries: SessionEntry[], details: PromptPermissionDetails, after?: TranscriptCursor): ClaudeCodeTranscript;
type ClaudeCodeFastVerdict = "allow" | "block" | "unparseable";
type ClaudeCodeVerdict = {
  outcome: "allow";
} | {
  outcome: "deny";
  category: string;
  reason: string;
};
/**
 * Judged by the opening tag alone, as Claude Code's `</block>` stop sequence leaves nothing after it; a reply that
 * opens any other way goes on to the second pass
 */
declare function parseFastVerdict(text: string): ClaudeCodeFastVerdict;
/** Throws on a reply with no verdict, or two that disagree, which retries the call */
declare function parseVerdict(text: string): ClaudeCodeVerdict;
declare const POLICY_REVISION: string;
declare function buildSystemPrompt(rules: AutoReviewConfig["autoMode"], contextFiles: readonly ContextFile[]): string;
declare const THINKING_PROMPT = "Second pass. The fast pass above leans toward blocking and ignores user intent and ALLOW exceptions, so its answer is not a finding. Follow the whole process now, keeping in mind that only explicit consent, never implied or suggested, clears a block. Reply with the verdict in the output format: <block>yes</block><category>…</category><reason>…</reason>, or <block>no</block>.";
/** A full review's first message: the transcript, then the fast-pass instruction */
declare function buildReviewMessage(transcript: ClaudeCodeTranscript): string;
export { type AutoReviewConfig, POLICY_REVISION as CLAUDE_CODE_POLICY_REVISION, THINKING_PROMPT as CLAUDE_CODE_THINKING_PROMPT, type ClaudeCodeFastVerdict, type ClaudeCodeTranscript, type ClaudeCodeVerdict, DEFAULT_CONFIG, POLICY_REVISION$1 as POLICY_REVISION, type RenderedTranscript, type ReviewAssessment, type ReviewPrompt, buildReviewMessage as buildClaudeCodeReviewMessage, buildSystemPrompt as buildClaudeCodeSystemPrompt, buildSystemPrompt$1 as buildSystemPrompt, parseFastVerdict as parseClaudeCodeFastVerdict, parseVerdict as parseClaudeCodeVerdict, renderTranscript as renderClaudeCodeTranscript, renderTranscript$1 as renderTranscript };
//# sourceMappingURL=review.d.ts.map