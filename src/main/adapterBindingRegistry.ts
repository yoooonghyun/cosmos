/**
 * adapterBindingRegistry — the ONE piece of per-integration knowledge main's spec rebinder
 * needs that is not already shared: which PROP of a list container holds its rows
 * (refreshable-custom-generative-ui multi-region).
 *
 * The shared layer already single-sources the bound-list PATH + pagination for every
 * `dataSource` (`AdapterSourcePath` + the per-integration `*BindOptionsForSource`). The only
 * thing main additionally needs to REWRITE an agent's LITERAL-prop container into a
 * `{path}`-bound one is the prop NAME the container reads its rows from (e.g. a Jira
 * `IssueList` reads `issues`; a Slack `MessageList` reads `messages`). This map is that
 * single source of truth, keyed by the non-secret `dataSource` (NOT the component type — the
 * Slack + Confluence `SearchResultList` share a type name but read different props, so the
 * dataSource is the unambiguous key).
 *
 * EXTENSIBLE: a new integration list source becomes rebindable by adding ONE entry here
 * (its rows prop) plus its existing `*BindOptionsForSource` entry — no rebinder change.
 *
 * Detail sources (`getIssue`/`getPage`) are intentionally ABSENT: they bind a single value
 * across several sub-path props (not a partitioned list), are never a multi-region case, and
 * keep using the existing single-region shell/descriptor path.
 */

import type { AdapterRegisterOptions } from './adapterDispatcher'
import { resolveBindOptionsForSource } from './descriptorShell'
import { LIST_SOURCE_DATA_PROP } from '../shared/adapter'

/**
 * The rows prop each LIST `dataSource`'s container component reads (FR — multi-region). The
 * SINGLE source of truth now lives in `src/shared/adapter.ts` ({@link LIST_SOURCE_DATA_PROP})
 * so the MCP render-server bundles — which CANNOT import this main-only module (it pulls in the
 * dispatcher/descriptorShell) — can share it for the bindings-first enforcement heuristic
 * (`src/shared/dataBearingSpec.ts`). Re-exported here so existing main-side importers keep their
 * `./adapterBindingRegistry` import path unchanged.
 */
export { LIST_SOURCE_DATA_PROP }

/** The rebind metadata for one LIST `dataSource`: the rows prop + its bind options. */
export interface ListSourceBinding {
  /** The container prop main rewrites from a literal array to a `{path}` binding. */
  dataProp: string
  /** The bound list path + pagination the dispatcher registers the region with. */
  options: AdapterRegisterOptions
}

/**
 * Resolve how to rebind a LIST `dataSource`'s container: its rows prop + bind options. Returns
 * `null` for a non-list / unknown source (a detail source, or one no integration claims) so the
 * caller skips rebinding that region and leaves it to the existing path.
 */
export function listSourceBinding(dataSource: string): ListSourceBinding | null {
  const dataProp = LIST_SOURCE_DATA_PROP[dataSource]
  if (dataProp === undefined) {
    return null
  }
  const options = resolveBindOptionsForSource(dataSource)
  if (options === null) {
    return null
  }
  return { dataProp, options }
}
