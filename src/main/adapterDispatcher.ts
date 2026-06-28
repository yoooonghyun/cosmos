/**
 * AdapterDispatcher — the generic, PANEL-AGNOSTIC main-side adapter dispatch path
 * (jira-generative-adapter-v1, FR-009..FR-018). The SHARED infrastructure the Jira →
 * Slack → Confluence sibling cycles reuse: Jira owns it here; the others register
 * their own surfaces against the same class.
 *
 * What it does, for a bound surface (registered via {@link AdapterDispatcher.register}):
 *   - REFRESH (FR-013/FR-014): on a refresh trigger (tab restore / panel re-activation /
 *     explicit refresh) or `adapter.refresh`, re-execute the descriptor and REPLACE the
 *     surface's bound list + cursor state via `updateDataModel` (NOT a full surface
 *     re-push — FR-009).
 *   - APPEND pagination (FR-015): on `adapter.loadMore`, fetch the next page with the
 *     held cursor, ACCUMULATE, and write the FULL accumulated list at the bound list
 *     path (never the RFC 6901 `-` append token).
 *   - PAGE-REPLACE pagination (FR-016): on `adapter.page`, fetch prev/next and REPLACE
 *     the list + update `hasMore`/`hasPrev` cursor state.
 *   - LOADING flag (FR-018): set `loading=true` on dispatch, `false` once data lands —
 *     pushed as its own `updateDataModel` so the control spinner is driven from the model.
 *   - SAFE FALLBACK (spec edges / FR-022): a fetch error / gone issue / stale cursor /
 *     empty page degrades to a recoverable notice value + cleared `loading`; the prior
 *     data is NOT corrupted. Never throws.
 *
 * SECRETS stay in main (FR-021): the dispatcher never sees a token — the injected
 * `resolve(descriptor)` does the manager call (token attached inside the manager) and
 * returns only non-secret, normalized data. The descriptor + every pushed payload are
 * secret-free.
 *
 * CHANNEL INDEPENDENCE (FR-012): constructed with ONLY a resolver, a `pushDataModel`
 * sink, and a `cancelActive` hook — NO PtyManager / AgentRunner dependency, so an
 * adapter action can never disturb the TUI or the headless runner (by construction).
 *
 * Pure of Electron: deps are injected so it is unit-testable without a window.
 */

import type { UiDataModelPayload } from '../shared/ipc'
import type {
  AdapterDescriptor,
  AdapterPageDirection,
  AdapterPaginationMode
} from '../shared/types/adapter'
import { AdapterDataKey, regionFlagPath, regionListPath } from '../shared/types/adapter'

/** Logger shape (injectable for tests). */
export type WarnFn = (message: string, ...args: unknown[]) => void

/**
 * The NORMALIZED, secret-free result of executing a descriptor (FR-009). The injected
 * {@link AdapterResolver} maps a manager read to this so the shared dispatcher stays
 * panel-agnostic — it never parses a Jira/Slack/Confluence DTO directly.
 *
 *  - `ok: true`  — `items` is the page's bound-list value (list surfaces); `value` is a
 *    single bound value (detail surfaces); `nextCursor`/`prevCursor` drive `hasMore`/
 *    `hasPrev`. Either `items` or `value` is supplied per the surface's shape.
 *  - `ok: false` — a recoverable failure: `kind` lets the caller route `reconnect`/
 *    `not_connected` to the native affordance; `message` is the non-secret notice copy.
 */
export type AdapterFetchResult =
  | {
      ok: true
      /** The bound-list value for a list surface (replaces / accumulates at the list path). */
      items?: unknown[]
      /** The bound value for a non-list (detail) surface — written at the list path. */
      value?: unknown
      /** Opaque next-page cursor; absent ⇒ no next page (`hasMore=false`). */
      nextCursor?: string
      /** Opaque prev-page cursor; absent ⇒ no prev page (`hasPrev=false`). */
      prevCursor?: string
    }
  | {
      ok: false
      /** Failure class so the caller can route reconnect/not-connected natively. */
      kind: string
      /** Non-secret, non-alarming notice message for the recoverable error state. */
      message: string
    }

/**
 * Resolve + execute a descriptor against the integration manager (token attached in
 * main), returning a normalized {@link AdapterFetchResult} (FR-009). One resolver per
 * panel maps the descriptor's `dataSource`/`query` to the right manager read and the
 * result DTO to the normalized shape. MUST NOT leak a secret into the result.
 *
 * @param descriptor the surface's secret-free descriptor (with the cursor for the page).
 */
export type AdapterResolver = (
  descriptor: AdapterDescriptor
) => Promise<AdapterFetchResult>

/** Options describing HOW a registered surface binds + paginates (FR-015/FR-016/FR-020). */
export interface AdapterRegisterOptions {
  /** The bound list/value path the surface renders (RFC 6901, e.g. `/items`). FR-001/FR-015. */
  listPath: string
  /** Which pagination shape this surface uses (append / replace / none). FR-020. */
  pagination: AdapterPaginationMode
}

export interface AdapterDispatcherDeps {
  /** Execute a descriptor → normalized result (token attached inside). FR-009. */
  resolve: AdapterResolver
  /** Push an `updateDataModel` to the renderer (keyed by surfaceId). FR-009/FR-010. */
  pushDataModel: (payload: UiDataModelPayload) => void
  /**
   * Settle the pending `render_ui` call as `cancel` so the composing run never blocks
   * (parallels the Jira write path's FR-016). Optional — a refresh/pagination action
   * on a display-only surface has no pending call, but calling it is harmless.
   */
  cancelActive?: () => void
  /** Optional warning logger. Defaults to console.warn. */
  warn?: WarnFn
}

/**
 * Internal per-REGION registration + live accumulation/cursor state. A region is one
 * data-bearing container of a surface (a kanban column, a dashboard panel); a classic
 * single-region surface has exactly one region keyed by the empty string. The data-model
 * paths are stored FULLY RESOLVED (already region-scoped) so `run` pushes to them
 * verbatim — the empty-key region resolves to the flat top-level paths (`/items`,
 * `/loading`) it always used.
 */
interface RegionState {
  descriptor: AdapterDescriptor
  /** Full region-scoped list/value path (e.g. `/items` or `/regions/col0/items`). */
  listPath: string
  /** Full region-scoped flag paths. Empty-key region ⇒ flat `/loading` etc. */
  loadingPath: string
  hasMorePath: string
  hasPrevPath: string
  errorPath: string
  pagination: AdapterPaginationMode
  /** Accumulated list for append pagination (the dispatcher holds it — FR-015). */
  accumulated: unknown[]
  /** The base (first-page) cursor, so a refresh restarts from the start. */
  baseCursor: string | undefined
  /** Cursors for the most recent page (drives hasMore/hasPrev). */
  nextCursor: string | undefined
  prevCursor: string | undefined
}

export class AdapterDispatcher {
  private readonly resolve: AdapterResolver
  private readonly pushDataModel: (payload: UiDataModelPayload) => void
  private readonly cancelActive?: () => void
  private readonly warn: WarnFn
  /** Bound surfaces by surfaceId → (regionKey → region state) (FR-010, multi-region). */
  private readonly surfaces = new Map<string, Map<string, RegionState>>()

  constructor(deps: AdapterDispatcherDeps) {
    this.resolve = deps.resolve
    this.pushDataModel = deps.pushDataModel
    this.cancelActive = deps.cancelActive
    this.warn = deps.warn ?? ((m, ...a) => console.warn(m, ...a))
  }

  /**
   * Register (or re-register) one bound REGION of a surface with its secret-free
   * descriptor + bind options (FR-006/FR-009). Called when a bound surface is composed or
   * restored — once per region (a single-region surface registers the empty `regionKey`).
   * A stale/garbage descriptor should be validated by `validateAdapterDescriptor` at the
   * boundary before this; here we just hold it. Re-registering a region resets its
   * accumulation. The region's list + flag paths are resolved + stored region-scoped (the
   * empty key keeps the flat top-level paths).
   */
  register(
    surfaceId: string,
    descriptor: AdapterDescriptor,
    opts: AdapterRegisterOptions,
    regionKey = ''
  ): void {
    let regions = this.surfaces.get(surfaceId)
    if (!regions) {
      regions = new Map<string, RegionState>()
      this.surfaces.set(surfaceId, regions)
    }
    regions.set(regionKey, {
      descriptor,
      listPath: regionListPath(regionKey, opts.listPath),
      loadingPath: regionFlagPath(regionKey, AdapterDataKey.Loading),
      hasMorePath: regionFlagPath(regionKey, AdapterDataKey.HasMore),
      hasPrevPath: regionFlagPath(regionKey, AdapterDataKey.HasPrev),
      errorPath: regionFlagPath(regionKey, 'error'),
      pagination: opts.pagination,
      accumulated: [],
      baseCursor: descriptor.query.cursor,
      nextCursor: undefined,
      prevCursor: undefined
    })
  }

  /**
   * Forget a surface region (its tab closed / region removed). With no `regionKey`, forget
   * EVERY region of the surface (the classic "forget the surface" — a closed tab). No-op
   * for an unknown id/region.
   */
  unregister(surfaceId: string, regionKey?: string): void {
    if (regionKey === undefined) {
      this.surfaces.delete(surfaceId)
      return
    }
    const regions = this.surfaces.get(surfaceId)
    regions?.delete(regionKey)
    if (regions && regions.size === 0) {
      this.surfaces.delete(surfaceId)
    }
  }

  /** True when ANY region is registered under this surfaceId. */
  has(surfaceId: string): boolean {
    return this.surfaces.has(surfaceId)
  }

  /** The region keys registered for a surface (empty for an unknown surface). */
  regionsOf(surfaceId: string): string[] {
    const regions = this.surfaces.get(surfaceId)
    return regions ? [...regions.keys()] : []
  }

  /**
   * REFRESH one region (FR-013/FR-014): re-execute its descriptor from the base cursor and
   * REPLACE that region's data model with fresh values. Used by tab restore, panel
   * re-activation, and the explicit refresh affordance (`adapter.refresh`). The view is NOT
   * re-composed; only the data model changes. `regionKey` defaults to the empty (single)
   * region. Never throws.
   */
  async refresh(surfaceId: string, regionKey = ''): Promise<void> {
    const state = this.getRegion(surfaceId, regionKey, 'refresh')
    if (!state) {
      return
    }
    // FR-013: a refresh supersedes any stale in-flight resolve for this surface;
    // cancel it (when the host wired a canceller) before refetching from page one.
    this.cancelActive?.()
    // Refresh restarts from the first page: clear accumulation + use the base cursor.
    const descriptor = this.withCursor(state.descriptor, state.baseCursor)
    await this.run(surfaceId, state, descriptor, 'replace-fresh')
  }

  /**
   * REFRESH EVERY region of a surface (the surface-level refresh event — the user's
   * "새로고침 이벤트가 각 컴포넌트로 fan-out"). Each region reloads from its OWN fetcher
   * concurrently; one region's failure degrades only that region (never throws).
   */
  async refreshSurface(surfaceId: string): Promise<void> {
    const regions = this.regionsOf(surfaceId)
    if (regions.length === 0) {
      this.warn('[adapter] refreshSurface — no surface registered for id:', surfaceId)
      return
    }
    await Promise.all(regions.map((regionKey) => this.refresh(surfaceId, regionKey)))
  }

  /**
   * APPEND pagination (FR-015): fetch the NEXT page with the held cursor, accumulate,
   * and write the FULL accumulated list at the bound list path. An empty next page
   * leaves the list unchanged and sets `hasMore=false`. Never throws.
   */
  async loadMore(surfaceId: string, regionKey = ''): Promise<void> {
    const state = this.getRegion(surfaceId, regionKey, 'loadMore')
    if (!state) {
      return
    }
    const descriptor = this.withCursor(state.descriptor, state.nextCursor)
    await this.run(surfaceId, state, descriptor, 'append')
  }

  /**
   * PAGE-REPLACE pagination (FR-016): fetch the prev/next page and REPLACE the list +
   * update cursor state. Never throws.
   */
  async page(surfaceId: string, direction: AdapterPageDirection, regionKey = ''): Promise<void> {
    const state = this.getRegion(surfaceId, regionKey, 'page')
    if (!state) {
      return
    }
    const cursor = direction === 'next' ? state.nextCursor : state.prevCursor
    const descriptor = this.withCursor(state.descriptor, cursor)
    await this.run(surfaceId, state, descriptor, 'page-replace')
  }

  /** Look up a region's state, warning (and returning undefined) for an unknown id/region. */
  private getRegion(
    surfaceId: string,
    regionKey: string,
    op: string
  ): RegionState | undefined {
    const state = this.surfaces.get(surfaceId)?.get(regionKey)
    if (!state) {
      this.warn(`[adapter] ${op} — no region registered for id/region:`, surfaceId, regionKey)
    }
    return state
  }

  /**
   * The shared fetch → apply pipeline for every trigger (FR-014/FR-015/FR-016/FR-018).
   *  1. set `loading=true` (FR-018);
   *  2. resolve the descriptor (token in main — FR-009/FR-021);
   *  3. on success, write the list (accumulate for append, replace otherwise) + the
   *     cursor flags; on failure, write a recoverable notice (prior data untouched);
   *  4. always clear `loading=false` (FR-018).
   * Never throws (FR-022) — a resolver rejection degrades to the error notice.
   */
  private async run(
    surfaceId: string,
    state: RegionState,
    descriptor: AdapterDescriptor,
    mode: 'replace-fresh' | 'append' | 'page-replace'
  ): Promise<void> {
    this.push(surfaceId, state.loadingPath, true)

    let result: AdapterFetchResult
    try {
      result = await this.resolve(descriptor)
    } catch (err) {
      this.warn('[adapter] resolver threw (handled):', err instanceof Error ? err.message : err)
      result = { ok: false, kind: 'network', message: 'Could not refresh. Please retry.' }
    }

    if (!result.ok) {
      // Recoverable failure: surface a notice value + clear loading; prior data intact.
      this.push(surfaceId, state.errorPath, result.message)
      this.push(surfaceId, state.loadingPath, false)
      return
    }

    // Clear any prior error notice now that fresh data landed.
    this.push(surfaceId, state.errorPath, undefined)

    if (mode === 'append') {
      // Accumulate + write the FULL list at the bound path (NOT the `-` append token).
      const next = Array.isArray(result.items) ? result.items : []
      state.accumulated = state.accumulated.concat(next)
      this.push(surfaceId, state.listPath, state.accumulated)
    } else {
      // replace-fresh / page-replace: replace the bound value, reset accumulation.
      const value = result.items !== undefined ? result.items : result.value
      state.accumulated = Array.isArray(result.items) ? [...result.items] : []
      this.push(surfaceId, state.listPath, value)
    }

    // Update cursor state + the bound enable/disable flags (FR-017).
    state.nextCursor = result.nextCursor
    state.prevCursor = result.prevCursor
    this.push(surfaceId, state.hasMorePath, result.nextCursor !== undefined)
    this.push(surfaceId, state.hasPrevPath, result.prevCursor !== undefined)
    this.push(surfaceId, state.loadingPath, false)
  }

  /** Return a copy of the descriptor with `query.cursor` set (or cleared). */
  private withCursor(descriptor: AdapterDescriptor, cursor: string | undefined): AdapterDescriptor {
    const query = { ...descriptor.query }
    if (cursor === undefined) {
      delete query.cursor
    } else {
      query.cursor = cursor
    }
    return { dataSource: descriptor.dataSource, query }
  }

  /** Push one `updateDataModel` keyed by surfaceId (FR-010). */
  private push(surfaceId: string, path: string, value: unknown): void {
    this.pushDataModel({ surfaceId, path, value })
  }
}
