/**
 * promptContextMarker — the PINNED, pure codec for the `<cosmos:context>` marker
 * (cosmos-timeline-prompt-context-v1, spec FR-012/FR-013/FR-014, Decision A).
 *
 * Channel (b) of "one source, two channels": a {@link PromptContext} is serialized into a
 * trailing `<cosmos:context>{json}</cosmos:context>` block appended to the user's utterance
 * after a blank line, so claude records it in the transcript user turn (free quit/relaunch
 * persistence). The Cosmos timeline parser detects + parses that block on each user-prompt turn
 * to render the context affordance, and STRIPS it so the bubble shows clean prose.
 *
 * PURE + node-tested: NO fs, React, Electron, or `Buffer` import (browser-safe — imported by the
 * renderer). Every layer is DEFENSIVE (spec FR-010/FR-020/FR-025): a missing/wrong-shape context
 * at submit serializes to `''` (the prompt is sent with no marker, never blocked); a malformed /
 * partial / dangling marker at parse drops the WHOLE block to no-context AND still strips the
 * trailing tag so the raw marker is NEVER shown.
 */

import type { DockKind, PromptContext, PromptPanelId } from './promptContext'

/** The reserved XML tag name (collision-safe against hand-typed prose). */
export const CONTEXT_TAG = 'cosmos:context'

/**
 * PINNED trailing-anchored detector for a WELL-FORMED marker block (spec FR-014/SC-008):
 * the user's prose, then optional blank line(s), then `<cosmos:context>…</cosmos:context>`
 * at the very end of the string.
 */
export const MARKER_RE = /\n*<cosmos:context>[\s\S]*?<\/cosmos:context>\s*$/

/** Captures the inner JSON payload of a well-formed trailing block. */
const MARKER_CAPTURE_RE = /\n*<cosmos:context>([\s\S]*?)<\/cosmos:context>\s*$/

/**
 * Strips ANY trailing block from the opening tag to end-of-string — well-formed OR a
 * dangling/partial tag with no proper close (spec FR-014/FR-025: a raw or partial marker is
 * never surfaced). Anchored to `$`, so it only ever removes a TRAILING `<cosmos:context>…`.
 */
const MARKER_STRIP_RE = /\n*<cosmos:context>[\s\S]*$/

/** Defensive cap on the serialized block length (~4 KB; spec FR-010). */
const MARKER_MAX_LEN = 4096

/** The dock-kind for each panel id — the SINGLE source so capture + parse agree (spec FR-005). */
export const DOCK_KIND_BY_PANEL: Record<PromptPanelId, DockKind | null> = {
  cosmos: null,
  jira: 'jira-issue',
  slack: 'slack-channel',
  confluence: 'confluence-page',
  'google-calendar': 'calendar-event'
}

const PANEL_IDS: ReadonlySet<string> = new Set<PromptPanelId>([
  'cosmos',
  'slack',
  'jira',
  'confluence',
  'google-calendar'
])

const DOCK_KINDS: ReadonlySet<string> = new Set<DockKind>([
  'jira-issue',
  'slack-channel',
  'confluence-page',
  'calendar-event'
])

/** The non-secret {@link ViewContext} item fields a dock may carry (whitelist — spec FR-005/FR-008). */
const VIEW_CONTEXT_KEYS = [
  'selectedIssueKey',
  'selectedChannelId',
  'selectedChannelName',
  'threadTs',
  'selectedPageId',
  'selectedPageTitle',
  'selectedEventId',
  'selectedEventTitle'
] as const

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/* ------------------------------------------------------------------ *
 * Serialize (channel b, submit side)
 * ------------------------------------------------------------------ */

/** Keep `kind` + only the POPULATED string ViewContext fields (drop empty/undefined). */
function compactDock(dock: PromptContext['dock']): Record<string, string> | null {
  if (!dock || !DOCK_KINDS.has(dock.kind)) {
    return null
  }
  const out: Record<string, string> = { kind: dock.kind }
  let populated = 0
  for (const key of VIEW_CONTEXT_KEYS) {
    const value = (dock as unknown as Record<string, unknown>)[key]
    if (isNonEmptyString(value)) {
      out[key] = value
      populated += 1
    }
  }
  // A dock with NO populated item field is not worth a marker dimension (spec FR-004).
  return populated > 0 ? out : null
}

/**
 * Serialize a {@link PromptContext} into the trailing marker block, or `''` when there is
 * nothing valid to embed (a missing/wrong-shape ctx, or an oversized serialization). The caller
 * appends the result to the utterance — `''` means "send the prompt with no marker" (spec FR-010).
 * The JSON carries `panel` (always), `tab` (omitted when absent), and `dock` (omitted when no
 * dock), with the dock's empty ViewContext fields stripped (spec FR-012).
 */
export function serializePromptContextMarker(ctx: PromptContext | undefined): string {
  if (
    !ctx ||
    typeof ctx !== 'object' ||
    typeof ctx.panel !== 'object' ||
    ctx.panel === null ||
    !PANEL_IDS.has(ctx.panel.id) ||
    !isNonEmptyString(ctx.panel.label)
  ) {
    return ''
  }
  const payload: Record<string, unknown> = {
    panel: { id: ctx.panel.id, label: ctx.panel.label }
  }
  if (ctx.tab && isNonEmptyString(ctx.tab.id) && isNonEmptyString(ctx.tab.label)) {
    payload.tab = { id: ctx.tab.id, label: ctx.tab.label }
  }
  const dock = compactDock(ctx.dock)
  if (dock) {
    payload.dock = dock
  }
  let json: string
  try {
    json = JSON.stringify(payload)
  } catch {
    return ''
  }
  const block = `\n\n<${CONTEXT_TAG}>${json}</${CONTEXT_TAG}>`
  if (block.length > MARKER_MAX_LEN) {
    return ''
  }
  return block
}

/* ------------------------------------------------------------------ *
 * Parse + strip (read side)
 * ------------------------------------------------------------------ */

/** Schema-validate a parsed JSON payload into a clean {@link PromptContext}, or null. */
function validatePayload(parsed: unknown): PromptContext | null {
  if (!parsed || typeof parsed !== 'object') {
    return null
  }
  const obj = parsed as Record<string, unknown>
  const panel = obj.panel
  if (
    !panel ||
    typeof panel !== 'object' ||
    !PANEL_IDS.has((panel as Record<string, unknown>).id as string) ||
    !isNonEmptyString((panel as Record<string, unknown>).label)
  ) {
    return null
  }
  const context: PromptContext = {
    panel: {
      id: (panel as Record<string, unknown>).id as PromptPanelId,
      label: (panel as Record<string, unknown>).label as string
    }
  }

  // tab — when present it MUST be well-formed; a partial tab makes the WHOLE marker malformed.
  if (obj.tab !== undefined) {
    const tab = obj.tab
    if (
      !tab ||
      typeof tab !== 'object' ||
      !isNonEmptyString((tab as Record<string, unknown>).id) ||
      !isNonEmptyString((tab as Record<string, unknown>).label)
    ) {
      return null
    }
    context.tab = {
      id: (tab as Record<string, unknown>).id as string,
      label: (tab as Record<string, unknown>).label as string
    }
  }

  // dock — when present it MUST have a known kind + ≥1 populated string item field.
  if (obj.dock !== undefined) {
    const dock = obj.dock
    if (!dock || typeof dock !== 'object') {
      return null
    }
    const dockObj = dock as Record<string, unknown>
    if (!DOCK_KINDS.has(dockObj.kind as string)) {
      return null
    }
    const clean: Record<string, string> = {}
    let populated = 0
    for (const key of VIEW_CONTEXT_KEYS) {
      if (isNonEmptyString(dockObj[key])) {
        clean[key] = dockObj[key] as string
        populated += 1
      }
    }
    if (populated === 0) {
      return null
    }
    context.dock = { kind: dockObj.kind as DockKind, ...clean }
  }

  return context
}

/**
 * Parse + strip the trailing marker from a turn's text (spec FR-014/FR-019/FR-020/FR-025).
 *  - No `<cosmos:context>` block at the end → `{ text }` unchanged.
 *  - A WELL-FORMED block that JSON-parses + schema-validates → `{ context, text }` with the
 *    block (and its leading blank line) stripped, so the bubble shows clean prose.
 *  - A well-formed block that fails to parse/validate, OR a dangling/partial trailing tag →
 *    NO context, but the trailing tag is STILL stripped (the raw marker is never shown).
 *
 * Never throws. The returned `text` is always safe to display; `context` is present only on a
 * fully valid marker (no partial chip — spec FR-020).
 */
export function parsePromptContextMarker(text: string): { context?: PromptContext; text: string } {
  if (typeof text !== 'string') {
    return { text: '' }
  }
  const match = MARKER_CAPTURE_RE.exec(text)
  if (match) {
    const stripped = text.replace(MARKER_STRIP_RE, '')
    try {
      const parsed: unknown = JSON.parse(match[1].trim())
      const context = validatePayload(parsed)
      if (context) {
        return { context, text: stripped }
      }
    } catch {
      // fall through to the no-context strip below
    }
    // Well-formed tags but bad JSON / shape → no context, but still strip (FR-020/FR-025).
    return { text: stripped }
  }
  // No well-formed block. Strip a DANGLING/partial trailing `<cosmos:context>…` if present
  // (a user-typed or model-echoed partial tag must never be surfaced — FR-025).
  if (MARKER_STRIP_RE.test(text)) {
    return { text: text.replace(MARKER_STRIP_RE, '') }
  }
  return { text }
}

/**
 * Defensively strip a trailing marker from a NON-user turn's display text (spec FR-025): the
 * model may echo the block, but the timeline must never surface the raw marker syntax in any
 * turn. Returns the text with any trailing `<cosmos:context>…` removed; attaches NO context.
 */
export function stripPromptContextMarker(text: string): string {
  if (typeof text !== 'string') {
    return ''
  }
  return MARKER_STRIP_RE.test(text) ? text.replace(MARKER_STRIP_RE, '') : text
}
