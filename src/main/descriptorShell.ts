/**
 * descriptorShell — pure resolvers mapping a secret-free {@link AdapterDescriptor}'s
 * `dataSource` to (a) JUST the {@link AdapterRegisterOptions} it implies
 * ({@link resolveBindOptionsForSource}) and (b) the FALLBACK data-free bound SHELL surface +
 * those options ({@link resolveDescriptorShell}).
 *
 * refreshable-custom-generative-ui-v1 (FR-001/FR-002/FR-006): the PRIMARY path is now
 * "register-the-agent-surface" — when the agent attaches a descriptor AND a usable custom
 * spec, main registers the descriptor under the AGENT's OWN `spec.surfaceId` using
 * {@link resolveBindOptionsForSource} (the options half, WITHOUT building a shell) and pushes
 * the agent's spec AS-IS so the custom layout (e.g. a kanban board) refreshes in place. The
 * generic {@link resolveDescriptorShell} SHELL is the FALLBACK ONLY when the agent supplied a
 * descriptor but no usable spec — it composes a fixed `{path}`-bound shell so a refresh intent
 * without a layout still yields something refreshable.
 *
 * Both resolvers share ONE source-of-truth: the per-integration bind-option resolvers
 * (`slackBindOptionsForSource`/`confluenceBindOptionsForSource`/`jiraBindOptionsForSource`),
 * so the path a tool description tells the agent to bind to and the path the dispatcher writes
 * can never drift (FR-002).
 *
 * Pure: no IPC, no dispatcher, no secrets — only a `{ dataSource }` lookup. The
 * Slack/Confluence/Jira `dataSource` namespaces are disjoint, so the source alone selects the
 * integration (Slack first, then Confluence, else Jira — mirrors the composite resolver).
 * Returns `null` for an unknown source (the caller renders the agent's spec un-refreshably —
 * FR-015).
 */

import type { A2uiSurfaceUpdate } from '../shared/ipc'
import type { AdapterDescriptor } from '../shared/types/adapter'
import type { AdapterRegisterOptions } from './adapterDispatcher'
import { buildSlackBoundShell } from './slack/slackSurfaceBuilder'
import { buildConfluenceBoundShell } from './confluence/confluenceSurfaceBuilder'
import { buildJiraBoundShell } from './jira/jiraSurfaceBuilder'
import { slackBindOptionsForSource } from './slack/slackAdapter'
import { confluenceBindOptionsForSource } from './confluence/confluenceAdapter'
import { jiraBindOptionsForSource } from './jira/jiraAdapter'

/** The composed bound SHELL + the bind options for a registerable descriptor. */
export interface DescriptorShell {
  /** The data-free `{path}`-bound surface spec main pushes (stable surfaceId per source). */
  spec: A2uiSurfaceUpdate
  /** The bind options (listPath + pagination) the dispatcher registers the surface with. */
  options: AdapterRegisterOptions
}

/**
 * Resolve JUST the bind options (`listPath` + `pagination`) a descriptor's `dataSource`
 * implies — the options half of {@link resolveDescriptorShell}, split out so main can register
 * the AGENT's OWN custom surface under its own `surfaceId` WITHOUT building a generic shell
 * (refreshable-custom-generative-ui-v1, FR-002). Slack first, then Confluence, else Jira — the
 * disjoint `dataSource` namespaces make the source unambiguous. This is the SAME
 * source-of-truth the generic shells use, so the path a tool description tells the agent to
 * bind to and the path the dispatcher writes can never drift. Returns `null` for an unknown
 * source (no integration's resolver claims it — the caller renders the agent's spec
 * un-refreshably, FR-015).
 */
export function resolveBindOptionsForSource(
  dataSource: string
): AdapterRegisterOptions | null {
  return (
    slackBindOptionsForSource(dataSource) ??
    confluenceBindOptionsForSource(dataSource) ??
    jiraBindOptionsForSource(dataSource)
  )
}

/**
 * Resolve the FALLBACK bound shell + bind options for `descriptor` (FR-006). Slack first, then
 * Confluence, else Jira — the disjoint `dataSource` namespaces make the source unambiguous.
 * Used ONLY when the agent attached a descriptor but no usable spec; otherwise main registers
 * the agent's own surface via {@link resolveBindOptionsForSource}. Returns `null` when no
 * integration owns the source (caller renders the literal spec un-refreshably — FR-015). Both
 * halves (shell + options) come from the SAME source check, so a resolvable shell always pairs
 * with concrete options.
 */
export function resolveDescriptorShell(descriptor: AdapterDescriptor): DescriptorShell | null {
  const { dataSource } = descriptor

  const slackOptions = slackBindOptionsForSource(dataSource)
  if (slackOptions !== null) {
    const spec = buildSlackBoundShell(dataSource)
    return spec ? { spec, options: slackOptions } : null
  }

  const confluenceOptions = confluenceBindOptionsForSource(dataSource)
  if (confluenceOptions !== null) {
    const spec = buildConfluenceBoundShell(dataSource)
    return spec ? { spec, options: confluenceOptions } : null
  }

  const jiraOptions = jiraBindOptionsForSource(dataSource)
  if (jiraOptions !== null) {
    const spec = buildJiraBoundShell(dataSource)
    return spec ? { spec, options: jiraOptions } : null
  }

  return null
}
