/**
 * specRebinder — turn an agent's LITERAL-prop custom surface into a `{path}`-bound,
 * refreshable one, GENERICALLY across integrations (refreshable-custom-generative-ui
 * multi-region). This is "Option 1": the composing model only has to NAME which container
 * gets which query (a {@link AdapterBinding}); it need NOT author A2UI `{path}` bindings
 * itself (which it does not do reliably). Main rewrites the bindings here.
 *
 * For each binding `{ componentId, descriptor }` whose `dataSource` is a known LIST source:
 *   1. find the container component by `componentId` in the spec;
 *   2. look up its rows prop ({@link listSourceBinding}) + bind options;
 *   3. choose the region key — '' for a SINGLE-region surface (flat top-level paths,
 *      back-compat with the existing bound surfaces), the `componentId` when there are
 *      MULTIPLE bound containers (a kanban's columns each get their own `/regions/<id>/…`
 *      sub-tree, so one column's data never overwrites another's — the user's "구분된
 *      컴포넌트 별로 별도의 data fetcher" model);
 *   4. REWRITE the container's literal rows prop → a region-scoped `{path}` binding, and its
 *      `loading`/`hasMore`/`error` props → the region's flag paths;
 *   5. SEED the literal rows the agent composed as that region's first page (so the surface
 *      paints instantly, before the first refresh re-fetches live data);
 *   6. emit a region registration so main registers each container's OWN fetcher/cursor.
 *
 * A binding whose source is unknown / a detail source / whose component is missing is SKIPPED
 * (warned) — it is not rebindable here. If NO binding is usable, returns `null` so the caller
 * falls back to the existing single-region shell path. Pure: no dispatcher, no IPC, no
 * secrets — only spec + bindings → a rewritten spec + seed + region list.
 */

import type { A2uiSurfaceUpdate, UiDataModelPayload } from '../shared/ipc'
import type { AdapterBinding, AdapterDescriptor } from '../shared/types/adapter'
import { AdapterDataKey, regionFlagPath, regionListPath } from '../shared/types/adapter'
import type { AdapterRegisterOptions } from './adapterDispatcher'
import { listSourceBinding } from './adapterBindingRegistry'

type Component = { id: string; component: string } & Record<string, unknown>

/** Logger shape (injectable for tests). */
type WarnFn = (message: string, ...args: unknown[]) => void

/** One region main must register with the dispatcher (the BASE listPath + pagination; the
 * dispatcher scopes it to the regionKey itself). */
export interface RebindRegion {
  /** The dispatcher region key ('' single / componentId multi). */
  regionKey: string
  /** The container component this region binds (the rewrite target). */
  componentId: string
  /** The container prop main rewrites to a `{path}` binding. */
  dataProp: string
  /** The secret-free descriptor that feeds this region. */
  descriptor: AdapterDescriptor
  /** The bind options (BASE listPath + pagination) to register the region with. */
  options: AdapterRegisterOptions
}

/**
 * Plan the regions a set of {@link AdapterBinding}s implies — WITHOUT a spec, so BOTH compose
 * (rebind) and RESTORE (re-register a persisted surface) derive the SAME regionKey/options
 * from the same bindings. Keeps only bindings naming a known LIST source. The region key is ''
 * for a lone bound container (flat top-level paths, back-compat) and the `componentId` when
 * there are multiple (each container its own `/regions/<id>/…` sub-tree).
 */
export function planRegions(
  bindings: AdapterBinding[],
  warn: WarnFn = (m, ...a) => console.warn(m, ...a)
): RebindRegion[] {
  const known = bindings
    .map((binding) => ({ binding, meta: listSourceBinding(binding.descriptor.dataSource) }))
    .filter((x): x is { binding: AdapterBinding; meta: NonNullable<typeof x.meta> } => {
      if (!x.meta) {
        warn('[rebind] skipping binding — not a rebindable list source:', x.binding.descriptor.dataSource)
        return false
      }
      return true
    })
  const multi = known.length > 1
  return known.map(({ binding, meta }) => ({
    regionKey: multi ? binding.componentId : '',
    componentId: binding.componentId,
    dataProp: meta.dataProp,
    descriptor: binding.descriptor,
    options: meta.options
  }))
}

/** The result of rebinding an agent surface against its per-region bindings. */
export interface RebindResult {
  /** The rewritten, `{path}`-bound spec main pushes (the agent's layout, made refreshable). */
  spec: A2uiSurfaceUpdate
  /** The initial data-model seed (each region's composed rows + `loading=false`/`hasMore`). */
  dataModel: UiDataModelPayload[]
  /** The regions to register with the AdapterDispatcher (one per bound container). */
  regions: RebindRegion[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** True when a prop value is already a `{path}` binding (the agent bound it itself). */
function isPathBinding(value: unknown): value is { path: string } {
  return isObject(value) && typeof value.path === 'string'
}

/**
 * Rebind an agent's custom surface against its per-region {@link AdapterBinding}s. Returns the
 * rewritten spec + seed + regions, or `null` when no binding is usable (caller falls back).
 */
export function rebindAgentSurface(
  spec: A2uiSurfaceUpdate,
  bindings: AdapterBinding[],
  warn: WarnFn = (m, ...a) => console.warn(m, ...a)
): RebindResult | null {
  const components = Array.isArray((spec as { components?: unknown }).components)
    ? ((spec as { components: Component[] }).components)
    : null
  if (!components) {
    return null
  }

  // Plan regions from the bindings — the SAME function restore uses, so a re-registered surface
  // derives identical regionKeys. planRegions already drops non-list sources (warned).
  const planned = planRegions(bindings, warn)
  if (planned.length === 0) {
    return null
  }

  const nextComponents = components.slice()
  const dataModel: UiDataModelPayload[] = []
  const regions: RebindRegion[] = []
  const surfaceId = spec.surfaceId

  for (const region of planned) {
    const index = nextComponents.findIndex((c) => c.id === region.componentId)
    if (index < 0) {
      warn('[rebind] skipping region — no component with id:', region.componentId)
      continue
    }

    const listPath = regionListPath(region.regionKey, region.options.listPath)
    const loadingPath = regionFlagPath(region.regionKey, AdapterDataKey.Loading)
    const hasMorePath = regionFlagPath(region.regionKey, AdapterDataKey.HasMore)
    const errorPath = regionFlagPath(region.regionKey, 'error')

    const original = nextComponents[index]
    const literal = original[region.dataProp]
    // REWRITE the container's data + flag props to the region's `{path}` bindings.
    // A MULTI-region container is also stamped with its `region` (= regionKey) so its
    // in-surface controls (LoadMoreButton/PaginationBar) emit `adapter.*` carrying that
    // region — main then reloads ONLY this container's fetcher. A single-region surface
    // (regionKey '') omits it so the control proceeds surface-wide (back-compat).
    nextComponents[index] = {
      ...original,
      [region.dataProp]: { path: listPath },
      loading: { path: loadingPath },
      hasMore: { path: hasMorePath },
      error: { path: errorPath },
      ...(region.regionKey ? { region: region.regionKey } : {})
    }

    // SEED the literal rows the agent composed (skip when the agent already bound the prop —
    // there is no literal to seed; the first refresh fills it). A non-array literal seeds [].
    const seedRows = isPathBinding(literal) ? [] : Array.isArray(literal) ? literal : []
    dataModel.push({ surfaceId, path: listPath, value: seedRows })
    dataModel.push({ surfaceId, path: loadingPath, value: false })
    dataModel.push({ surfaceId, path: hasMorePath, value: false })

    regions.push(region)
  }

  if (regions.length === 0) {
    return null
  }

  return { spec: { ...spec, components: nextComponents }, dataModel, regions }
}
