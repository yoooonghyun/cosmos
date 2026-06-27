/**
 * PURE transcript → conversation-model normalization (cosmos-conversation-panel-v2,
 * step 3). Spec: FR-102/FR-103/FR-104/FR-108.
 *
 * `parseTranscript(lines)` turns the raw jsonl lines of the default session's transcript
 * into the ordered, secret-safe {@link ConversationTurn}[] the renderer consumes. It is
 * the `.ts` half of the `.ts`/`.test.ts` split: NO fs, Electron, or React import, so it is
 * unit-tested in node against fixture lines. The main-process {@link
 * import('./transcriptReader').TranscriptReader} owns the actual file read and hands the
 * lines here.
 *
 * Mapping (FR-102):
 *  - `type:"user"` with a STRING `message.content`, or an array with a `{type:"text"}`
 *    block → a `user-prompt` turn (its text). A `user` line carrying ONLY
 *    `{type:"tool_result"}` blocks is NOT a prompt — its results correlate to prior
 *    tool calls instead.
 *  - `type:"assistant"` `{type:"text"}` blocks → `assistant-text` turns.
 *  - `type:"assistant"` `{type:"tool_use"}` blocks → `tool-call` turns, EXCEPT the
 *    `render_ui`-family tool (name `mcp__cosmos-render-ui__render_ui`) → a `surface` turn
 *    carrying `input.spec`.
 *  - `type:"user"` `{type:"tool_result"}` blocks → correlated (by `tool_use_id`) onto the
 *    matching `tool-call` turn's `resultPreview`.
 *
 * Skipped (FR-103): `permission-mode`, `file-history-snapshot`, `attachment`,
 * `queue-operation`, any `isSidechain:true` line, and any line whose JSON does not parse
 * (a malformed / partial trailing line is dropped — FR-108).
 *
 * Secret-safety (FR-104): tool args/results are surfaced ONLY as a bounded, sanitized
 * one-line preview (`previewArgs`), and anything pattern-matching a secret is redacted.
 */

import type { ConversationTurn, ToolCallTurn } from '../shared/conversation'
import { PREVIEW_MAX_LEN } from '../shared/conversation'
import type { A2uiSurfaceUpdate } from '../shared/ipc/ui'

/** The transcript tool name the render_ui MCP server records (FR-102, pinned from a real transcript). */
export const RENDER_UI_TOOL_NAME = 'mcp__cosmos-render-ui__render_ui'

/** Top-level transcript line `type`s that are claude bookkeeping, never user-visible (FR-103). */
const NOISE_TYPES: ReadonlySet<string> = new Set([
  'permission-mode',
  'file-history-snapshot',
  'attachment',
  'queue-operation'
])

/**
 * Patterns that mark a value as a likely secret (FR-104). Conservative — tokens never
 * reach the claude sandbox, so this is belt-and-suspenders against an unexpected leak.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /(?:xox[abposr]-[A-Za-z0-9-]{8,})/g, // Slack tokens
  /gh[posu]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/g, // JWT
  /AKIA[0-9A-Z]{16}/g, // AWS access key id
  /[A-Za-z0-9_-]*(?:secret|token|password|api[_-]?key|bearer)[A-Za-z0-9_-]*\s*[:=]\s*\S+/gi
]

/** True for a top-level line that is conversation noise / a sidechain (FR-103). */
function isNoiseLine(obj: Record<string, unknown>): boolean {
  if (obj.isSidechain === true) {
    return true
  }
  const type = obj.type
  return typeof type === 'string' && NOISE_TYPES.has(type)
}

/** Redact anything pattern-matching a secret, then collapse + clamp to a one-line preview (FR-104). */
export function previewArgs(value: unknown): string {
  let text: string
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    text = ''
  }
  if (!text) {
    return ''
  }
  for (const pattern of SECRET_PATTERNS) {
    // Each pattern carries the global flag; reset lastIndex defensively (patterns are
    // module-level + reused across calls) before replacing every match.
    pattern.lastIndex = 0
    text = text.replace(pattern, '[redacted]')
  }
  // Collapse whitespace to a single line, then clamp.
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > PREVIEW_MAX_LEN ? oneLine.slice(0, PREVIEW_MAX_LEN - 1) + '…' : oneLine
}

/** Concatenate all `{type:"text"}` blocks in a content array into one string. */
function textFromBlocks(blocks: unknown[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    if (block && typeof block === 'object') {
      const b = block as Record<string, unknown>
      if (b.type === 'text' && typeof b.text === 'string') {
        parts.push(b.text)
      }
    }
  }
  return parts.join('\n\n')
}

/** Extract the content array (or null) from a transcript line's `message`. */
function contentBlocks(message: unknown): unknown[] | null {
  if (message && typeof message === 'object') {
    const content = (message as Record<string, unknown>).content
    if (Array.isArray(content)) {
      return content
    }
  }
  return null
}

/**
 * Parse the transcript's raw jsonl LINES into the ordered conversation model. Malformed /
 * empty / partial lines are skipped (FR-108); noise + sidechain lines are dropped (FR-103);
 * the rest are mapped per FR-102. Tool results are correlated to their tool-call turn by
 * `tool_use_id` (FR-102). Order follows line appearance (the transcript is append-ordered).
 */
export function parseTranscript(lines: string[]): ConversationTurn[] {
  const turns: ConversationTurn[] = []
  // tool_use_id → the tool-call turn it produced, so a later tool_result attaches its preview.
  const toolCallById = new Map<string, ToolCallTurn>()

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    let obj: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (!parsed || typeof parsed !== 'object') {
        continue
      }
      obj = parsed as Record<string, unknown>
    } catch {
      continue // FR-108: a malformed / partial trailing line is skipped.
    }
    if (isNoiseLine(obj)) {
      continue
    }
    const id = typeof obj.uuid === 'string' ? obj.uuid : ''
    const ts = typeof obj.timestamp === 'string' ? obj.timestamp : ''
    if (!id) {
      continue // every turn needs a stable id (FR-101); a line without one is skipped.
    }

    if (obj.type === 'user') {
      const message = obj.message
      // A STRING content → a user prompt (FR-102).
      if (message && typeof message === 'object') {
        const content = (message as Record<string, unknown>).content
        if (typeof content === 'string') {
          if (content.trim().length > 0) {
            turns.push({ kind: 'user-prompt', id, ts, text: content })
          }
          continue
        }
      }
      const blocks = contentBlocks(message)
      if (!blocks) {
        continue
      }
      // Correlate any tool_result blocks onto their tool-call turn (FR-102).
      for (const block of blocks) {
        if (block && typeof block === 'object') {
          const b = block as Record<string, unknown>
          if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
            const call = toolCallById.get(b.tool_use_id)
            if (call) {
              call.resultPreview = previewArgs(b.content)
            }
          }
        }
      }
      // A text block in a user line is still a prompt (FR-102).
      const text = textFromBlocks(blocks)
      if (text.trim().length > 0) {
        turns.push({ kind: 'user-prompt', id, ts, text })
      }
      continue
    }

    if (obj.type === 'assistant') {
      const blocks = contentBlocks(obj.message)
      if (!blocks) {
        continue
      }
      for (const block of blocks) {
        if (!block || typeof block !== 'object') {
          continue
        }
        const b = block as Record<string, unknown>
        if (b.type === 'text' && typeof b.text === 'string' && b.text.trim().length > 0) {
          turns.push({ kind: 'assistant-text', id, ts, text: b.text })
        } else if (b.type === 'tool_use' && typeof b.name === 'string') {
          // A tool_use block carries its OWN id (`toolu_…`); use it for result correlation,
          // and the line `uuid` (+ block name) for the turn id so sibling tool_uses on one
          // line stay distinct.
          const blockId = typeof b.id === 'string' ? b.id : id
          const turnId = `${id}:${blockId}`
          if (b.name === RENDER_UI_TOOL_NAME) {
            const input = b.input
            const spec =
              input && typeof input === 'object'
                ? (input as Record<string, unknown>).spec
                : undefined
            if (spec && typeof spec === 'object') {
              turns.push({ kind: 'surface', id: turnId, ts, spec: spec as A2uiSurfaceUpdate })
            }
          } else {
            const turn: ToolCallTurn = {
              kind: 'tool-call',
              id: turnId,
              ts,
              toolName: b.name,
              argPreview: previewArgs(b.input)
            }
            turns.push(turn)
            if (typeof b.id === 'string') {
              toolCallById.set(b.id, turn)
            }
          }
        }
      }
      continue
    }
    // Any other top-level type (unknown / future) is ignored defensively.
  }

  return turns
}
