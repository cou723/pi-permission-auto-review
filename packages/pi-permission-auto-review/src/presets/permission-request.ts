import type { PromptPermissionDetails } from '@gotgenes/pi-permission-system'

const PERMISSION_FIELDS = [
  'requestId',
  'source',
  'agentName',
  'payload',
  'toolCallId',
  'toolName',
  'skillName',
  'path',
  'command',
  'target',
  'toolInputPreview',
  // sessionLabel / sessionApproval は「このセッションで許可」を選んだ場合の候補であり、既存の許可ではない。
  // 分類器が既存の許可範囲と誤読しないよう渡さない（権限 UI やセッション記録は変えない）。
  'surface',
  'value',
  'forwarding',
  'accessIntent',
] as const

/** The ask as the reviewer sees it, never truncated: a reviewer must not approve an action it saw only in part */
export function permissionRequest(details: PromptPermissionDetails): Record<string, unknown> {
  return Object.fromEntries(
    PERMISSION_FIELDS.flatMap(field => (details[field] === undefined ? [] : [[field, details[field]]])),
  )
}
