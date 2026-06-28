/**
 * descriptorRegistration — the PURE decision for how main registers an agent-attached
 * descriptor (refreshable-custom-generative-ui-v1, FR-001/FR-002/FR-006/FR-015).
 *
 * Split out of `index.ts`'s `registerAgentSurface` closure so the register-vs-shell-vs-skip
 * decision is node-testable with the REAL bind-option resolvers + shell builder (the closure
 * itself only does the side effects: `adapterDispatcher.register` + `refresh`, and returns the
 * pushed spec). The decision is:
 *
 *   - registerable source (`resolveBindOptionsForSource` ≠ null) + USABLE agent spec
 *     (non-empty `surfaceId` + a `components` array) → register the AGENT's OWN surface under
 *     `agentSpec.surfaceId` with the resolved bind options; push the AGENT's spec AS-IS (FR-001).
 *   - registerable source + UNUSABLE agent spec → FALLBACK to the generic `{path}`-bound SHELL:
 *     register the shell's surfaceId; push the shell (FR-006).
 *   - unknown source (no resolver claims it) → register NOTHING; push the agent's spec
 *     unchanged, un-refreshably (FR-015).
 *
 * Pure: no dispatcher, no IPC, no secrets — only a `{ descriptor, agentSpec }` → plan lookup.
 */

import type { A2uiSurfaceUpdate } from '../../shared/ipc'
import type { AdapterDescriptor } from '../../shared/types/adapter'
import type { AdapterRegisterOptions } from './adapterDispatcher'
import { resolveBindOptionsForSource, resolveDescriptorShell } from './descriptorShell'

/** The resolved registration plan for an agent-attached descriptor. */
export type AgentSurfaceRegistration =
  | {
      /** Something is registerable — main registers + kicks the first refresh. */
      register: true
      /** The surfaceId to register under (the agent's own id, or the shell's on fallback). */
      surfaceId: string
      /** The bind options (listPath + pagination) to register with. */
      options: AdapterRegisterOptions
      /** The spec main pushes: the agent's spec (FR-001) or the shell's (FR-006). */
      spec: A2uiSurfaceUpdate
    }
  | {
      /** Nothing registerable — main pushes the agent's spec unchanged, un-refreshably. */
      register: false
      spec: A2uiSurfaceUpdate
    }

/** True for a structurally-usable agent surface spec (FR-001): real id + a components array. */
function isUsableSpec(spec: A2uiSurfaceUpdate | undefined): spec is A2uiSurfaceUpdate {
  return (
    !!spec &&
    typeof spec.surfaceId === 'string' &&
    spec.surfaceId.length > 0 &&
    Array.isArray((spec as { components?: unknown }).components)
  )
}

/**
 * Decide how to register `descriptor` for the agent's `agentSpec` (FR-001/FR-006/FR-015).
 * Pure — the caller performs the `register`/`refresh` side effects when `register` is true.
 */
export function planAgentSurfaceRegistration(
  descriptor: AdapterDescriptor,
  agentSpec: A2uiSurfaceUpdate
): AgentSurfaceRegistration {
  const options = resolveBindOptionsForSource(descriptor.dataSource)

  // FR-001: a registerable source + a usable spec → register the AGENT's own surface as-is.
  if (options && isUsableSpec(agentSpec)) {
    return { register: true, surfaceId: agentSpec.surfaceId, options, spec: agentSpec }
  }

  // FR-006: a registerable source but an unusable spec → fall back to the generic shell.
  if (options) {
    const shell = resolveDescriptorShell(descriptor)
    if (shell) {
      return {
        register: true,
        surfaceId: shell.spec.surfaceId,
        options: shell.options,
        spec: shell.spec
      }
    }
  }

  // FR-015: unknown source → nothing registered; the agent's spec renders un-refreshably.
  return { register: false, spec: agentSpec }
}
