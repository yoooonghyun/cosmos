/**
 * dataBearingWarning — main-side re-export of the bindings-first no-binding heuristic.
 *
 * The predicate itself moved to `src/shared/dataBearingSpec.ts` so the MCP render-server
 * bundles (which run outside Electron and cannot import this main-only tree) can share ONE
 * source of truth for the bindings-first ENFORCEMENT (each `render_*_ui` tool rejects an
 * unbound data surface so the model resubmits with a binding per container). Main's
 * `UiBridge.onMessage` keeps importing `specHasUnboundDataContainer` from here for its
 * dev-facing no-binding WARNING; this thin re-export keeps that import path stable.
 *
 * See `src/shared/dataBearingSpec.ts` for the heuristic, its conservative false-positive-free
 * rules, and how the "data-bearing" prop set is derived from `LIST_SOURCE_DATA_PROP`.
 */

export {
  firstUnboundDataContainerId,
  specHasUnboundDataContainer
} from '../shared/dataBearingSpec'
