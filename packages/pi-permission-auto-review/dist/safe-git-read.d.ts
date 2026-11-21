import { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { PromptPermissionDetails } from "@gotgenes/pi-permission-system";
/**
 * 判定に使う Git。既定は PATH 上の git。
 * パッケージ側（Nix など）は、PATH 上の別プログラムを判定に使わないよう、
 * ビルド後にこの値を固定した絶対パスへ置き換えてよい。
 */
export declare const GIT_COMMAND = "git";
export type SafeGitOperation = "status" | "diff";
export declare function matchSafeGitRead(command: unknown): SafeGitOperation | undefined;
/**
 * Git を起動せずに判定できる部分。これを満たす要求だけを isSafeGitRead で確かめる。
 * 分割済みの command やプレビューだけでは、同じ呼び出しの書き込みを見落とすため、実引数の command 全体を見る。
 * 別セッションからの転送は cwd と入力の出所が異なるため対象外
 */
export declare function safeGitReadCandidate(details: PromptPermissionDetails, input: unknown): SafeGitOperation | undefined;
export declare function isSafeGitRead(details: PromptPermissionDetails, input: unknown, context: Pick<ExtensionContext, "cwd">, signal: AbortSignal): Promise<boolean>;
//# sourceMappingURL=safe-git-read.d.ts.map