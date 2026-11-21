import { beforeAll } from 'vitest'
import { scriptCandidates } from '../src/reviewer/review-context.js'

// Bash の WASM パーサーは初回だけ非同期に初期化され、偽のタイマー（vi.useFakeTimers）の下では完了しない。
// 各テストファイルの前に読み込んでおき、審査の経路では初期化済みのパーサーを使わせる
beforeAll(async () => {
  await scriptCandidates('true', undefined)
})
