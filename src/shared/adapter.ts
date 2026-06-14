/**
 * Shared API→UI generative-adapter contract (jira-generative-adapter-v1).
 *
 * The PANEL-AGNOSTIC, secret-free pieces every sibling cycle (Jira → Slack →
 * Confluence) reuses verbatim. This file is the single source of truth for:
 *
 *  1. The persisted {@link AdapterDescriptor} `{ dataSource, query }` — how to
 *     REFETCH a bound surface's data (FR-005/FR-006/FR-007). Secret-free by
 *     construction: it carries only a non-secret integration-call id (`dataSource`)
 *     and non-secret query params (`query`) — never a token, OAuth material, or the
 *     Atlassian `client_secret` (FR-007/FR-021).
 *  2. The reserved {@link AdapterAction} namespace (`adapter.*`) main intercepts at
 *     the `ui:action` boundary (paralleling `jira.*`), dispatched deterministically
 *     and NEVER returned to the composing agent (FR-019).
 *  3. The bound-surface data-model key names the builders + catalog components agree
 *     on (`hasMore`/`hasPrev`/`loading` + the list/cursor paths) so a refresh /
 *     pagination push and the surface's `{path}` bindings never disagree (FR-017/018).
 *
 * The `updateDataModel` PUSH payload itself is the SDK's `UpdateDataModelPayload`
 * (`{ surfaceId, path?, value? }`); it is re-exported through `src/shared/ipc.ts` as
 * {@link UiDataModelPayload} and validated at the main boundary by
 * `validateUiDataModel` (FR-009/FR-010/FR-022). No field here is Jira-specific — the
 * Jira-concrete descriptor SHAPES live in `src/shared/jira.ts` (FR-008).
 */

/**
 * The reserved adapter-action names (FR-019). A bound catalog control emits one of
 * these as its action `name`; main matches on the {@link ADAPTER_ACTION_PREFIX} and
 * dispatches it deterministically via the AdapterDispatcher — it is NEVER resolved
 * back to the composing `claude` run (parallels the `jira.*` reservation).
 *
 *  - `adapter.refresh`  — re-execute the descriptor; replace the data model (FR-013/014).
 *  - `adapter.loadMore` — APPEND pagination: fetch the next page, write the FULL
 *                         accumulated list at the bound path (FR-015).
 *  - `adapter.page`     — PAGE-REPLACE pagination: fetch a page (prev/next), REPLACE
 *                         the list + update cursor state (FR-016).
 */
export const AdapterAction = {
  /** Re-execute the descriptor and replace the data model (FR-013/FR-014). */
  Refresh: 'adapter.refresh',
  /** Append pagination — fetch next page, grow the bound list (FR-015). */
  LoadMore: 'adapter.loadMore',
  /** Page-replace pagination — fetch prev/next page, replace the list (FR-016). */
  Page: 'adapter.page'
} as const

export type AdapterActionName = (typeof AdapterAction)[keyof typeof AdapterAction]

/** The reserved namespace prefix main discriminates on at the `ui:action` boundary. */
export const ADAPTER_ACTION_PREFIX = 'adapter.'

/** True when an `actionId` is in the reserved `adapter.*` namespace (FR-019). */
export function isAdapterActionId(actionId: string | undefined): actionId is string {
  return typeof actionId === 'string' && actionId.startsWith(ADAPTER_ACTION_PREFIX)
}

/**
 * The direction a page-replace ({@link AdapterAction.Page}) action moves (FR-016).
 * Carried as non-secret context on the action; main resolves it to the descriptor's
 * prev/next cursor.
 */
export type AdapterPageDirection = 'next' | 'prev'

/**
 * Reserved data-model KEY NAMES every bound surface's builder + catalog components
 * agree on (FR-017/FR-018). Centralized so a pagination/refresh push and the
 * surface's `{path}` / `LogicExpression` bindings never disagree on a string.
 *
 * The list path itself is descriptor-/surface-specific (e.g. Jira uses `items`), so it
 * is NOT fixed here — only the cross-cutting flags + cursor state are. Paths are the
 * bare top-level keys; a `{path}` binding references them as `/<key>` (RFC 6901).
 */
export const AdapterDataKey = {
  /** Boolean: a next page exists → enables load-more / Next (FR-017). */
  HasMore: 'hasMore',
  /** Boolean: a previous page exists → enables Prev (FR-017). */
  HasPrev: 'hasPrev',
  /** Boolean: a refresh/pagination fetch is in flight → drives the spinner (FR-018). */
  Loading: 'loading'
} as const

export type AdapterDataKeyName = (typeof AdapterDataKey)[keyof typeof AdapterDataKey]

/**
 * The DOCUMENTED per-`dataSource` data-model PATHS an agent binds a CUSTOM refreshable
 * surface against (refreshable-custom-generative-ui-v1, FR-002/FR-004). SINGLE SOURCE OF
 * TRUTH shared by BOTH:
 *  - main's bind-option resolvers (each integration's `*_PATH` constant references the value
 *    here), which is what `resolveBindOptionsForSource` registers + the dispatcher writes; and
 *  - the render-tool descriptions (each `render_*_ui` tool interpolates these into the text it
 *    teaches the agent),
 * so the path the agent binds to (`{path}`) and the path the dispatcher pushes can never drift.
 *
 * Keyed by the non-secret `dataSource` call id. List sources write their rows at the path; a
 * detail source (`getIssue`/`getPage`) writes its single value there. The shared reserved flag
 * paths (`/loading`, `/hasMore`, `/error`) are NOT per-source — see {@link AdapterFlagPath}.
 */
export const AdapterSourcePath = {
  // Jira
  searchIssues: '/items',
  getIssue: '/issue',
  // Slack
  listChannels: '/channels',
  getHistory: '/messages',
  search: '/matches',
  // Confluence
  defaultFeed: '/feed',
  searchContent: '/results',
  getPage: '/page'
} as const

export type AdapterSourceId = keyof typeof AdapterSourcePath

/**
 * The rows PROP each LIST `dataSource`'s container component reads its rows from
 * (refreshable-custom-generative-ui multi-region). Keyed by the non-secret `dataSource`
 * (NOT the component type — Slack + Confluence `SearchResultList` share a type name but
 * read different props, so the dataSource is the unambiguous key).
 *
 * SINGLE SOURCE OF TRUTH, shared (secret-free, no main-only deps) so BOTH:
 *  - main's rebinder (`adapterBindingRegistry.listSourceBinding` re-exports it to resolve
 *    which prop to rewrite from a literal array to a `{path}` binding), and
 *  - the bindings-first no-binding heuristic ({@link specHasUnboundDataContainer} in
 *    `src/shared/dataBearingSpec.ts`, imported by the MCP render-server bundles to ENFORCE
 *    that every data container declares a binding),
 * derive the data-prop set from ONE place and cannot drift.
 *
 * EXTENSIBLE: a new integration list source becomes rebindable + enforced by adding ONE
 * entry here (its rows prop) plus its existing `*BindOptionsForSource` entry.
 *
 * Detail sources (`getIssue`/`getPage`) are intentionally ABSENT — they bind a single value
 * across several sub-path props, never a partitioned list (the detail bind props are listed
 * separately in `src/shared/dataBearingSpec.ts`).
 */
export const LIST_SOURCE_DATA_PROP: Readonly<Record<string, string>> = {
  // Jira — IssueList.issues
  searchIssues: 'issues',
  // Slack — ChannelList.channels / MessageList.messages / SearchResultList.matches
  listChannels: 'channels',
  getHistory: 'messages',
  search: 'matches',
  // Confluence — SearchResultList.results (search) + the same component for the feed
  searchContent: 'results',
  defaultFeed: 'results'
}

/**
 * The shared RESERVED flag data-model paths every refreshable surface may bind, independent of
 * `dataSource` (FR-004). `/loading` toggles during a refresh/pagination fetch; `/hasMore`
 * reflects a next page (append/replace lists); `/error` carries a non-secret recoverable notice
 * (the prior data stays visible). Single-sourced alongside {@link AdapterSourcePath} so the tool
 * descriptions and the dispatcher agree on the strings ({@link AdapterDataKey} owns the bare
 * top-level KEY names; these are their `/`-prefixed RFC 6901 paths plus `/error`).
 */
export const AdapterFlagPath = {
  loading: '/loading',
  hasMore: '/hasMore',
  error: '/error'
} as const

/**
 * One BOUND REGION of a custom surface (refreshable-custom-generative-ui multi-region):
 * a single data-bearing container (e.g. one kanban column's `IssueList`) paired with the
 * secret-free descriptor that feeds it. The composing agent attaches a `bindings` array —
 * one entry per partitioned container — instead of one surface-wide descriptor, so each
 * container has its OWN fetcher + cursor + pagination and refreshes INDEPENDENTLY (the
 * user's "구분된 컴포넌트 별로 별도의 data fetcher" model).
 *
 *  - `componentId` — the `id` of the container component in the surface's `components`
 *    array whose literal data prop main rewrites to a region-scoped `{path}` binding. It
 *    is ALSO the `regionKey` the dispatcher keys this region's state under (escaped into
 *    the region's data-model paths via {@link regionListPath}/{@link regionFlagPath}).
 *  - `descriptor` — the narrowed, secret-free `{ dataSource, query }` for THIS region
 *    (e.g. the same `searchIssues` source with a column-specific JQL like
 *    `status = "In Review"`). Carries no token — main attaches it at fetch time.
 *
 * A single-region surface (one descriptor for the whole surface) is the degenerate case:
 * exactly one binding whose `componentId` is the lone data container.
 */
export interface AdapterBinding {
  /** The container component's id — the rebind target AND the dispatcher region key. */
  componentId: string
  /** The secret-free descriptor that feeds THIS region (its own query + pagination). */
  descriptor: AdapterDescriptor
}

/**
 * The reserved data-model sub-tree every MULTI-region surface namespaces its regions
 * under (RFC 6901). A region keyed `col0` writes its list at `/regions/col0/items` and
 * its flags at `/regions/col0/loading` etc., so sibling columns never collide. The
 * single/legacy region (empty key) keeps the flat top-level paths (`/items`, `/loading`)
 * for back-compat with the existing bound Jira/Slack/Confluence surfaces.
 */
export const ADAPTER_REGION_ROOT = '/regions'

/** Escape one RFC 6901 reference token (so an arbitrary componentId is path-safe). */
function escapePointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1')
}

/**
 * The data-model path a region's LIST/VALUE is written + bound at. The empty `regionKey`
 * (single/legacy region) returns `listPath` unchanged (flat top-level, e.g. `/items`); a
 * non-empty key namespaces it under {@link ADAPTER_REGION_ROOT} (e.g.
 * `/regions/col0/items`). Both the dispatcher's push and main's `{path}` rebind call this,
 * so the bound path and the pushed path can never drift.
 */
export function regionListPath(regionKey: string, listPath: string): string {
  if (regionKey === '') {
    return listPath
  }
  return `${ADAPTER_REGION_ROOT}/${escapePointerToken(regionKey)}${listPath}`
}

/**
 * The data-model path a region's FLAG (`loading`/`hasMore`/`hasPrev`/`error`) is written +
 * bound at. Empty `regionKey` → the flat top-level flag (`/loading`); a non-empty key →
 * region-scoped (`/regions/col0/loading`). Single-sourced with {@link regionListPath}.
 */
export function regionFlagPath(regionKey: string, flag: string): string {
  if (regionKey === '') {
    return `/${flag}`
  }
  return `${ADAPTER_REGION_ROOT}/${escapePointerToken(regionKey)}/${flag}`
}

/**
 * A persisted, SECRET-FREE adapter descriptor: how to REFETCH a bound surface's data
 * (FR-005/FR-006/FR-007). Associated with a surface by `surfaceId` in-flight and
 * persisted beside the surface's view spec in the session snapshot (FR-006).
 *
 *  - `dataSource` — identifies WHICH integration-manager read to re-run (a non-secret
 *    call id, e.g. Jira `searchIssues`/`getIssue`). The dispatcher maps it to a
 *    concrete manager call via an injected resolver (panel-agnostic — FR-009).
 *  - `query` — the non-secret params that read takes (e.g. JQL, cursor, issueKey).
 *    A bag of JSON-serializable, non-secret values only.
 *
 * INVARIANT (FR-007/FR-021): no token, OAuth material, or `client_secret` may ever
 * appear here. Main attaches the token at fetch time; the descriptor is pure query
 * intent. Carrying it in the snapshot/IPC payload is therefore safe.
 */
export interface AdapterDescriptor {
  /** Non-secret integration-call id the dispatcher's resolver maps to a manager read. */
  dataSource: string
  /** Non-secret query params for that read (JQL/cursor/issueKey/…). Never a secret. */
  query: AdapterQuery
}

/**
 * A descriptor's non-secret query params. A flat bag of JSON values — the concrete
 * per-integration shape (e.g. {@link JiraAdapterQuery}) narrows it. The `cursor` is
 * the only field the shared dispatcher reads generically (for pagination); everything
 * else is opaque to the shared layer and consumed by the integration's resolver.
 */
export interface AdapterQuery {
  /** Opaque pagination cursor for the next page; absent on the first page. */
  cursor?: string
  /** Any further non-secret params (JQL, issueKey, …) the resolver understands. */
  [key: string]: unknown
}

/**
 * Which pagination SHAPE a bound surface uses (FR-015/FR-016/design §5.3). A surface
 * uses EXACTLY one; the dispatcher branches on it to decide append-vs-replace.
 *  - `append`  — load-more / infinite: accumulate + write the full list (FR-015).
 *  - `replace` — prev/next: swap the list + update cursor state (FR-016).
 *  - `none`    — no pagination (e.g. the Jira issue-detail surface, FR-020).
 */
export type AdapterPaginationMode = 'append' | 'replace' | 'none'

/**
 * The validated reserved adapter action, discriminated by `name`, ready for the
 * dispatcher (FR-019). Produced by `validateAdapterAction` from a validated
 * `ui:action`; an unknown name / missing field never yields one (warn + ignore).
 *
 * Every variant carries the `surfaceId` of the surface the action targets so the
 * dispatcher pushes the resulting `updateDataModel` to the correct surface (FR-010).
 */
export type AdapterActionRequest =
  | {
      name: typeof AdapterAction.Refresh
      surfaceId: string
      /**
       * Optional secret-free descriptor for LAZY (RE-)REGISTRATION on a restore /
       * re-activation refresh (FR-013): a restored tab carries its persisted descriptor
       * so main can re-register the surface it never freshly composed, then refresh.
       * Absent for the manual RefreshButton (the surface is already registered).
       */
      descriptor?: AdapterDescriptor
      /**
       * Optional secret-free {@link AdapterBinding}s for LAZY MULTI-region (re-)registration on a
       * restore/re-activation refresh: a restored CUSTOM partitioned surface carries its persisted
       * bindings so main re-registers EVERY region (each container's descriptor + cursor) before
       * the fan-out refresh. Mutually-preferred over `descriptor` (a single-region surface persists
       * `descriptor`; a multi-region one persists `bindings`). Absent for the manual refresh chrome
       * (the surface is already registered).
       */
      bindings?: AdapterBinding[]
      /**
       * Optional region (componentId) to refresh. ABSENT ⇒ refresh EVERY region of the
       * surface (the surface-level refresh chrome / the user's "refresh event fans out to
       * each component"). Present ⇒ reload just that one container's fetcher.
       */
      region?: string
    }
  | { name: typeof AdapterAction.LoadMore; surfaceId: string; region?: string }
  | {
      name: typeof AdapterAction.Page
      surfaceId: string
      direction: AdapterPageDirection
      region?: string
    }
