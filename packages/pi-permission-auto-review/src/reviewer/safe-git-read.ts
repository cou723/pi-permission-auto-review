import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { PromptPermissionDetails } from '@gotgenes/pi-permission-system'
import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

// シェル全体が限定的な Git 閲覧である場合だけ、モデル審査を省く。
// 信頼済みのローカル実行環境を前提とした限定ルールであり、OS サンドボックスではない。

const exec = promisify(execFile)
const SAFE_COMMAND = /^[\w./:@+ =\t-]+$/
const SAFE_PATH = /^[\w./@+-]+$/
const UNIFIED_CONTEXT = /^(?:-U|--unified=)\d+$/
const WORD_SEPARATOR = /[ \t]+/
const DIFF_HELPER_CONFIG = String.raw`^(core\.fsmonitor|diff\.external|diff\..*\.(command|textconv))$`

/**
 * 判定に使う Git。既定は PATH 上の git。
 * パッケージ側（Nix など）は、PATH 上の別プログラムを判定に使わないよう、
 * ビルド後にこの値を固定した絶対パスへ置き換えてよい。
 */
export const GIT_COMMAND = 'git'

const STATUS_FLAGS: ReadonlySet<string> = new Set([
  '-s',
  '-b',
  '-sb',
  '--short',
  '--branch',
  '--porcelain',
  '--porcelain=v1',
  '--porcelain=v2',
  '--untracked-files=no',
  '--untracked-files=normal',
  '--untracked-files=all',
  '--ignore-submodules=all',
])
const DIFF_FLAGS: ReadonlySet<string> = new Set([
  '--stat',
  '--numstat',
  '--shortstat',
  '--name-only',
  '--name-status',
  '--check',
  '--cached',
  '--staged',
  '--no-color',
  '--color=never',
  '--no-ext-diff',
  '--no-textconv',
  '--no-renames',
  '--exit-code',
  '--quiet',
  '--ignore-submodules=all',
])

export type SafeGitOperation = 'status' | 'diff'

export function matchSafeGitRead(command: unknown): SafeGitOperation | undefined {
  // 引用、展開、リダイレクト、改行、連結、環境変数代入は解釈せず審査へ戻す
  if (typeof command !== 'string' || !SAFE_COMMAND.test(command)) {
    return undefined
  }
  const words = command.trim().split(WORD_SEPARATOR)
  if (words.shift() !== 'git') {
    return undefined
  }
  if (words[0] === '--no-pager') {
    words.shift()
  }
  const operation = words.shift()
  const flags = operation === 'status' ? STATUS_FLAGS : operation === 'diff' ? DIFF_FLAGS : undefined
  if (flags === undefined) {
    return undefined
  }
  let paths = false
  for (const word of words) {
    if (paths) {
      if (!SAFE_PATH.test(word)) {
        return undefined
      }
    } else if (word === '--') {
      paths = true
    } else if (!flags.has(word) && !(operation === 'diff' && UNIFIED_CONTEXT.test(word))) {
      return undefined
    }
  }

  return operation === 'status' ? 'status' : 'diff'
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
}

function commandOf(input: unknown): string | undefined {
  return typeof input === 'object' && input !== null && 'command' in input && typeof input.command === 'string'
    ? input.command
    : undefined
}

/**
 * Git を起動せずに判定できる部分。これを満たす要求だけを isSafeGitRead で確かめる。
 * 分割済みの command やプレビューだけでは、同じ呼び出しの書き込みを見落とすため、実引数の command 全体を見る。
 * 別セッションからの転送は cwd と入力の出所が異なるため対象外
 */
export function safeGitReadCandidate(details: PromptPermissionDetails, input: unknown): SafeGitOperation | undefined {
  if (details.toolName !== 'bash' || details.forwarding !== undefined || details.accessIntent?.surface !== 'bash') {
    return undefined
  }
  const command = commandOf(input)
  const operation = matchSafeGitRead(command)
  if (operation === undefined || command === undefined || command.trim() !== details.command?.trim()) {
    return undefined
  }

  return operation
}

export async function isSafeGitRead(
  details: PromptPermissionDetails,
  input: unknown,
  context: Pick<ExtensionContext, 'cwd'>,
  signal: AbortSignal,
): Promise<boolean> {
  const operation = safeGitReadCandidate(details, input)
  if (operation === undefined || signal.aborted) {
    return false
  }
  const externalDiff = process.env['GIT_EXTERNAL_DIFF']
  if (operation === 'diff' && externalDiff !== undefined && externalDiff !== '') {
    return false
  }
  const options = { cwd: context.cwd, signal, timeout: 1000, maxBuffer: 65_536 }
  try {
    // status/diff でも fsmonitor や外部 diff/textconv はコードを実行できる。
    // 設定は出力・記録せず、該当設定がある場合は通常の審査へ戻す
    try {
      const { stdout } = await exec(
        GIT_COMMAND,
        ['--no-pager', 'config', '--includes', '--null', '--get-regexp', DIFF_HELPER_CONFIG],
        options,
      )
      for (const record of stdout.split('\0').filter(Boolean)) {
        const split = record.indexOf('\n')
        const name = record.slice(0, split).toLowerCase()
        const value = record.slice(split + 1).toLowerCase()
        if (name !== 'core.fsmonitor' || !['false', 'no', 'off', '0'].includes(value)) {
          return false
        }
      }
    } catch (error) {
      // git config の終了コード 1 は「一致するキーなし」。その他の失敗は許可しない
      if (errorCode(error) !== 1 || signal.aborted) {
        return false
      }
    }
    const { stdout } = await exec(GIT_COMMAND, ['--no-pager', 'rev-parse', '--show-toplevel'], options)
    try {
      // サブモジュール側の外部ヘルパーまでは検査しない
      await access(join(stdout.trim(), '.gitmodules'))

      return false
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        return false
      }
    }

    return !signal.aborted
  } catch {
    return false
  }
}
