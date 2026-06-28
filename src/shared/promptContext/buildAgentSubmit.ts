/**
 * buildAgentSubmit — the "one source, two channels" submit chokepoint
 * (cosmos-timeline-prompt-context-v1, spec FR-011/FR-013/FR-017).
 *
 * Both Open-Prompt submit sites (`useGenerativePanelTabs.submit` and `CosmosPanel.onSubmit`)
 * call this with the captured {@link PromptContext}. It returns the {@link AgentSubmitPayload}
 * that drives BOTH channels from that ONE object so they can never disagree:
 *
 *  - Channel (b), ADDITIVE: the `<cosmos:context>` marker is appended to the utterance (TRAILING,
 *    after a blank line — spec FR-013), so claude records it in the transcript user turn. On any
 *    defensive failure the marker is simply omitted (`serializePromptContextMarker` → `''`), and
 *    the prompt is sent plain — the submit is never blocked (spec FR-010).
 *  - Channel (a), AUTHORITATIVE + UNCHANGED: `viewContext` is derived from `ctx.dock` (the literal
 *    {@link ViewContext} item fields, minus the `kind` discriminator) — the EXACT shape `agent.submit`
 *    already sends today, so grounding (`viewContextGroundingClause` → `--append-system-prompt`) is
 *    byte-identical. It is ALWAYS derived from `ctx.dock` REGARDLESS of whether the marker
 *    serialized, so a dropped/oversized marker can NEVER weaken grounding (spec SC-010/SC-011).
 *
 * PURE + node-tested: NO DOM/IPC/Electron import. The caller keeps the RAW (pre-marker) utterance
 * for the live bubble so the displayed text stays clean (spec FR-024).
 */

import type { AgentSubmitPayload, UiRenderTarget, ViewContext } from '../ipc'
import type { PromptContext } from './promptContext'
import { serializePromptContextMarker } from './promptContextMarker'

/** Recover the literal {@link ViewContext} from a dock descriptor by dropping the `kind`. */
function dockToViewContext(dock: PromptContext['dock']): ViewContext | undefined {
  if (!dock) {
    return undefined
  }
  const { kind: _kind, ...rest } = dock
  return Object.keys(rest).length > 0 ? (rest as ViewContext) : undefined
}

/**
 * Build the agent-submit payload for an Open-Prompt submit, feeding the captured PromptContext to
 * both channels (spec FR-017). `viewContext` is set from `ctx.dock` even when the marker is dropped
 * (grounding never breaks on a malformed/oversized marker — spec SC-010).
 */
export function buildAgentSubmitWithMarker(
  utterance: string,
  target: UiRenderTarget,
  ctx?: PromptContext
): AgentSubmitPayload {
  const marker = serializePromptContextMarker(ctx)
  const payload: AgentSubmitPayload = {
    utterance: utterance + marker,
    target
  }
  const viewContext = dockToViewContext(ctx?.dock)
  if (viewContext) {
    payload.viewContext = viewContext
  }
  return payload
}
