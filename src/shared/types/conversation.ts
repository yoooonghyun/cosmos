/**
 * The normalized, secret-safe CONVERSATION DATA MODEL for the Cosmos default-session
 * timeline (cosmos-conversation-panel-v2, step 3). Spec: FR-101/FR-104.
 *
 * This is the ONLY conversation shape that crosses main → renderer over the
 * `conversation:*` IPC channel. It is derived in MAIN from the default session's
 * transcript jsonl (by `transcriptParse.ts`) and consumed by the renderer's Cosmos
 * panel. It carries NO raw transcript line, file path, token, OAuth secret, credential,
 * or `~/.claude` location (FR-104/FR-106) — only display-safe turns.
 *
 * Pure data: NO React, fs, or Electron import, so it is shared by main, preload, and
 * renderer and unit-tested in node.
 */

import type { A2uiSurfaceUpdate } from '../ipc/ui'
import type { PromptContext } from '../promptContext/promptContext'

/**
 * One ordered item in the conversation timeline (FR-101). A discriminated union keyed
 * by `kind`. Every variant carries a stable `id` (the transcript line `uuid`, used to
 * reconcile the live in-flight turn — FR-111) and an ISO `ts` for ordering.
 */
export type ConversationTurn =
  | UserPromptTurn
  | AssistantTextTurn
  | ToolCallTurn
  | SurfaceTurn

/** A user's prompt — the text they typed (FR-102). */
export interface UserPromptTurn {
  kind: 'user-prompt'
  /** Stable id (transcript line `uuid`). */
  id: string
  /** ISO timestamp for ordering. */
  ts: string
  /** The prompt text (display-safe; user-authored). The embedded `<cosmos:context>` marker is
   *  stripped before this is set, so it shows clean prose (cosmos-timeline-prompt-context-v1,
   *  FR-019/FR-025). */
  text: string
  /**
   * The non-secret screen-context snapshot parsed from this turn's embedded `<cosmos:context>`
   * marker (cosmos-timeline-prompt-context-v1, FR-019). Present ONLY when a well-formed marker
   * was found; absent/malformed → omitted (the turn renders as a plain bubble — FR-020/FR-021).
   */
  context?: PromptContext
}

/** An assistant text reply (markdown-ish model output — FR-102). */
export interface AssistantTextTurn {
  kind: 'assistant-text'
  id: string
  ts: string
  /** The assistant's text. Rendered sanitized in the renderer (model output, untrusted). */
  text: string
}

/**
 * A non-render tool call the agent made (FR-102). Carries ONLY a bounded, sanitized
 * projection — the tool name + a short display-safe argument preview — NEVER a raw
 * arg/result blob or anything pattern-matching a secret (FR-104).
 */
export interface ToolCallTurn {
  kind: 'tool-call'
  id: string
  ts: string
  /** The tool's name (e.g. `Read`, `Bash`). Display label. */
  toolName: string
  /** A bounded, sanitized one-line argument preview (≤ a fixed cap). May be empty. */
  argPreview: string
  /** A bounded, sanitized preview of the correlated tool_result, when one was found. */
  resultPreview?: string
}

/**
 * A generated A2UI surface the agent produced via the `render_ui`-family tool (FR-102).
 * Carries ONLY the non-secret A2UI `spec` (already non-secret by the render contract),
 * rendered inline + interactive in the timeline (FR-109/FR-110).
 */
export interface SurfaceTurn {
  kind: 'surface'
  id: string
  ts: string
  /** The A2UI surfaceUpdate spec to render inline. */
  spec: A2uiSurfaceUpdate
}

/**
 * The full normalized conversation for the default session (FR-101). `state`
 * distinguishes an EMPTY conversation (no turns yet) from a POPULATED one so the
 * renderer can pick its empty vs. timeline view without inspecting `turns.length`
 * (the read result's `ok:false` carries `empty`/`unreadable` separately — see
 * {@link import('./ipc/conversation').ConversationResult}).
 */
export interface Conversation {
  /** The default session id this conversation was read for (non-secret uuid), if known. */
  sessionId?: string
  /** The ordered timeline turns (FR-101). */
  turns: ConversationTurn[]
  /** `'empty'` ⇒ no turns; `'populated'` ⇒ ≥1 turn. */
  state: 'empty' | 'populated'
}

/** A fixed cap on any sanitized preview string the model carries (FR-104 bounding). */
export const PREVIEW_MAX_LEN = 200
