import { PromptPermissionDetails } from "@gotgenes/pi-permission-system";
/** Bash AST の実行位置だけから候補を抽出する。本文・検索語・リダイレクト先は対象外 */
declare function scriptCandidates(command: string, cwd: string | undefined): Promise<string[]>;
type ScriptEvidenceStatus = "complete" | "truncated" | "omitted-file-limit" | "omitted-total-budget" | "withheld-sensitive-path" | "withheld-too-large" | "withheld-binary" | "unreadable";
interface ScriptEvidence {
  path: string;
  realPath?: string;
  bytes: number;
  status: ScriptEvidenceStatus;
  totalChars?: number;
  shownChars?: number;
  sha256?: string;
  content?: string;
}
/** 審査ログに残す形。本文は複製しない */
interface ScriptEvidenceStat {
  path: string;
  status: ScriptEvidenceStatus;
  bytes: number;
  totalChars: number | undefined;
  shownChars: number | undefined;
  sha256: string | undefined;
}
/**
 * 実行対象のスクリプトを読み出す。存在しないパスは実行も失敗するので黙って除く。
 * 読めない・載せられないものは理由つきで「内容なし」として渡し、審査側に不明点を伝える。
 * 本文は最大 MAX_FILES 件とし、件数を超えた候補もメタデータだけは残す
 */
declare function collectScriptEvidence(details: PromptPermissionDetails, toolInput: unknown, cwd: string | undefined): Promise<ScriptEvidence[]>;
/** 審査プロンプトの末尾へ付ける証拠。1 行 1 ファイルの JSON にして、本文中の区切り文字で崩れないようにする */
declare function renderScriptEvidence(items: readonly ScriptEvidence[] | undefined): string;
/** 本文を複製せず、添付の不足箇所とファイルの版だけを審査ログに残す */
declare function scriptEvidenceStats(items?: readonly ScriptEvidence[]): ScriptEvidenceStat[];
/** 人の確認へ回すときの通知。理由が日本語でなければ、その旨を添えて原文を示す */
declare function confirmationNotice(reason: unknown): string;
/** 自動審査を完了できず、人の確認へ回すときの通知 */
declare function failureNotice(category: string): string;
export { confirmationNotice as a, scriptCandidates as c, collectScriptEvidence as i, scriptEvidenceStats as l, ScriptEvidenceStat as n, failureNotice as o, ScriptEvidenceStatus as r, renderScriptEvidence as s, ScriptEvidence as t };
//# sourceMappingURL=review-context-CDC5-K_M.d.ts.map