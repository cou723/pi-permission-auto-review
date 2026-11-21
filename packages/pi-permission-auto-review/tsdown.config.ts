import type { UserConfig } from 'tsdown'
import { defineConfig } from 'tsdown'

const shared = {
  deps: {
    // ホスト（Pi）と peer の permission-system は自前のコピーを持たない。WASM は node_modules から解決する
    neverBundle: [
      '@earendil-works/pi-ai',
      '@earendil-works/pi-coding-agent',
      '@gotgenes/pi-permission-system',
      'web-tree-sitter',
    ],
    onlyBundle: ['valibot'],
  },
  fixedExtension: false,
  format: 'esm',
  minify: false,
  platform: 'node',
  sourcemap: true,
  target: 'node24',
} satisfies UserConfig

const config: UserConfig[] = defineConfig([
  {
    ...shared,
    // Pi が読み込む拡張の入口。Pi は拡張のファイルを1つずつ変換・評価するため、共有チャンクを作らず1ファイルにまとめる
    clean: true,
    dts: true,
    entry: { index: 'src/index.ts' },
  },
  {
    ...shared,
    // 公開 API（./review）と、パッケージ側の結合テストが直接読み込むモジュール
    clean: false,
    dts: true,
    entry: {
      review: 'src/review.ts',
      'review-context': 'src/reviewer/review-context.ts',
      'review-router': 'src/reviewer/review-router.ts',
      'safe-git-read': 'src/reviewer/safe-git-read.ts',
    },
  },
])

export default config
