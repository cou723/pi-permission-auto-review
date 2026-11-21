import { join } from "node:path";
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import process from "node:process";
import { promisify } from "node:util";

// src/reviewer/safe-git-read.ts
const exec = promisify(execFile);
const SAFE_COMMAND = /^[\w./:@+ =\t-]+$/;
const SAFE_PATH = /^[\w./@+-]+$/;
const UNIFIED_CONTEXT = /^(?:-U|--unified=)\d+$/;
const WORD_SEPARATOR = /[ \t]+/;
const DIFF_HELPER_CONFIG = String.raw`^(core\.fsmonitor|diff\.external|diff\..*\.(command|textconv))$`;
/**
* 判定に使う Git。既定は PATH 上の git。
* パッケージ側（Nix など）は、PATH 上の別プログラムを判定に使わないよう、
* ビルド後にこの値を固定した絶対パスへ置き換えてよい。
*/
const GIT_COMMAND = "git";
const STATUS_FLAGS = /* @__PURE__ */ new Set([
	"-s",
	"-b",
	"-sb",
	"--short",
	"--branch",
	"--porcelain",
	"--porcelain=v1",
	"--porcelain=v2",
	"--untracked-files=no",
	"--untracked-files=normal",
	"--untracked-files=all",
	"--ignore-submodules=all"
]);
const DIFF_FLAGS = /* @__PURE__ */ new Set([
	"--stat",
	"--numstat",
	"--shortstat",
	"--name-only",
	"--name-status",
	"--check",
	"--cached",
	"--staged",
	"--no-color",
	"--color=never",
	"--no-ext-diff",
	"--no-textconv",
	"--no-renames",
	"--exit-code",
	"--quiet",
	"--ignore-submodules=all"
]);
function matchSafeGitRead(command) {
	if (typeof command !== "string" || !SAFE_COMMAND.test(command)) return;
	const words = command.trim().split(WORD_SEPARATOR);
	if (words.shift() !== "git") return;
	if (words[0] === "--no-pager") words.shift();
	const operation = words.shift();
	const flags = operation === "status" ? STATUS_FLAGS : operation === "diff" ? DIFF_FLAGS : void 0;
	if (flags === void 0) return;
	let paths = false;
	for (const word of words) if (paths) {
		if (!SAFE_PATH.test(word)) return;
	} else if (word === "--") paths = true;
	else if (!flags.has(word) && !(operation === "diff" && UNIFIED_CONTEXT.test(word))) return;
	return operation === "status" ? "status" : "diff";
}
function errorCode(error) {
	return typeof error === "object" && error !== null && "code" in error ? error.code : void 0;
}
function commandOf(input) {
	return typeof input === "object" && input !== null && "command" in input && typeof input.command === "string" ? input.command : void 0;
}
/**
* Git を起動せずに判定できる部分。これを満たす要求だけを isSafeGitRead で確かめる。
* 分割済みの command やプレビューだけでは、同じ呼び出しの書き込みを見落とすため、実引数の command 全体を見る。
* 別セッションからの転送は cwd と入力の出所が異なるため対象外
*/
function safeGitReadCandidate(details, input) {
	if (details.toolName !== "bash" || details.forwarding !== void 0 || details.accessIntent?.surface !== "bash") return;
	const command = commandOf(input);
	const operation = matchSafeGitRead(command);
	if (operation === void 0 || command === void 0 || command.trim() !== details.command?.trim()) return;
	return operation;
}
async function isSafeGitRead(details, input, context, signal) {
	const operation = safeGitReadCandidate(details, input);
	if (operation === void 0 || signal.aborted) return false;
	const externalDiff = process.env["GIT_EXTERNAL_DIFF"];
	if (operation === "diff" && externalDiff !== void 0 && externalDiff !== "") return false;
	const options = {
		cwd: context.cwd,
		signal,
		timeout: 1e3,
		maxBuffer: 65536
	};
	try {
		try {
			const { stdout } = await exec("git", [
				"--no-pager",
				"config",
				"--includes",
				"--null",
				"--get-regexp",
				DIFF_HELPER_CONFIG
			], options);
			for (const record of stdout.split("\0").filter(Boolean)) {
				const split = record.indexOf("\n");
				const name = record.slice(0, split).toLowerCase();
				const value = record.slice(split + 1).toLowerCase();
				if (name !== "core.fsmonitor" || ![
					"false",
					"no",
					"off",
					"0"
				].includes(value)) return false;
			}
		} catch (error) {
			if (errorCode(error) !== 1 || signal.aborted) return false;
		}
		const { stdout } = await exec("git", [
			"--no-pager",
			"rev-parse",
			"--show-toplevel"
		], options);
		try {
			await access(join(stdout.trim(), ".gitmodules"));
			return false;
		} catch (error) {
			if (errorCode(error) !== "ENOENT") return false;
		}
		return !signal.aborted;
	} catch {
		return false;
	}
}

export { GIT_COMMAND, isSafeGitRead, matchSafeGitRead, safeGitReadCandidate };
//# sourceMappingURL=safe-git-read.js.map