/**
 * useGenerativePanelTabs — the shared originating-tab correlation for the four
 * generative rail panels (panel-tabs v1, Track B / Phase 6). Generated UI, Slack,
 * Confluence, and Jira all need the SAME renderer-only correlation (the load-bearing
 * decision in the plan): mark the active/auto-created tab in-flight on submit, file
 * the next `ui:render` for this panel's `target` into that originating tab, surface
 * an errored run there, and discard a frame whose tab was closed (FR-027).
 *
 * Keeping it in ONE hook (over `usePanelTabs` + `panelTabs.ts` pure logic) means no
 * panel re-inlines the correlation, and the per-panel components only differ in
 * chrome (native base vs idle placeholder) and `target`/catalog. Jira additionally
 * files its deterministic default-view + `jira.*` write re-pushes (which arrive as
 * unsolicited `target:'jira'` frames with no pending utterance) into the active tab —
 * handled here uniformly because an unsolicited frame with no originating tab simply
 * lands in the active tab (see `fileFrame`).
 *
 * Spec trace: FR-012 (fill active), FR-012a (auto-create first tab), FR-013 (land in
 * originating tab), FR-014 (in-flight), FR-015 (error in originating tab), FR-019
 * (target→tab routing), FR-020 (Jira write re-push lands in its tab), FR-027 (closed
 * originating tab discards the frame).
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import type {
  AgentStatusPayload,
  GenerativePanelSnapshot,
  UiRenderPayload,
  UiRenderTarget,
  ViewContext
} from '../../shared/ipc'
import { usePanelTabs, type PanelTabsController } from './usePanelTabs'
import { buildAgentSubmitWithMarker } from '../../shared/promptContext/buildAgentSubmit'
import { DOCK_KIND_BY_PANEL } from '../../shared/promptContext/promptContextMarker'
import type { PromptContext, PromptPanelId } from '../../shared/promptContext/promptContext'
import {
  defaultRequestDecision,
  labelFromUtterance,
  panelTabLabel,
  seedEverOpenedFrom,
  shouldApplyAutoLabel,
  shouldFlushDeferredDefault
} from './panelTabs'
import { buildGenerativePanel, hydrateGenerativeTabs } from '../session/sessionSnapshot'
import { inFlightOnSubmit, shouldReleaseInFlightOnCompleted } from '../composer/promptComposerLogic'
import { useRecordSubmitContext } from '../composer/ActiveComposerProvider'
import { usePublishPanelTabs, usePublishTabCommands } from '../panelTabs'
import type { CrossPanelId, LivePanelTabs, TabCommands } from '../panelTabs'
import { useReportPanel } from '../session/SessionProvider'
import type { GenerativePanelKey } from '../../shared/ipc'
import type { AdapterBinding, AdapterDescriptor } from '../../shared/types/adapter'
import { randomTabIconId, type TabIconId } from '../../shared/tabIcons'

/** A rendered surface stored on a tab: the spec to (re)process + its requestId. */
export interface TabSurface {
  requestId: string
  spec: UiRenderPayload['spec']
  /**
   * The bound surface's INITIAL data-model seed (jira-generative-adapter-v1,
   * FR-001/FR-003): ordered `{ surfaceId, path?, value? }` pushes ActiveTabSurface
   * applies right after createSurface/updateComponents so the surface paints its
   * first page of bound data + flags. Absent for a non-bound surface.
   */
  dataModel?: UiRenderPayload['dataModel']
  /**
   * The bound surface's SECRET-FREE adapter descriptor (jira-generative-adapter-v1,
   * FR-006/FR-013): carried onto the rendered surface so ActiveTabSurface can fire a
   * restore/re-activation refresh (with the descriptor for lazy re-registration in main)
   * when a stored surface is (re)mounted. Absent for a non-bound surface.
   */
  descriptor?: AdapterDescriptor
  /**
   * The PARTITIONED surface's per-container {@link AdapterBinding}s (refreshable-custom-
   * generative-ui multi-region). Carried onto the rendered surface so ActiveTabSurface fires a
   * restore refresh that re-registers EVERY region in main. Mutually exclusive with
   * {@link descriptor} (multi-region uses bindings; single-region uses descriptor).
   */
  bindings?: AdapterBinding[]
  /**
   * True only for a surface re-instated from the session snapshot (jira-generative-
   * adapter-v1, FR-013): its data model is stale, so ActiveTabSurface fires the
   * descriptor-bearing restore refresh that lazily re-registers it in main + re-fetches.
   * A FRESHLY composed surface is already registered + seeded live in main, so it does
   * NOT set this (no redundant first-page re-fetch on every default-view compose).
   */
  restored?: boolean
  /** Set when the surface could not be rendered, for a safe fallback (SC-005). */
  error?: string
}

/** A generative tab record shared by all four generative panels. */
export interface GenerativeTab {
  id: string
  label: string
  /** True while a `+`-created tab has not composed yet (FR-009 → "Untitled"). */
  untitled: boolean
  surface: TabSurface | null
  inFlight: boolean
  /** A failed-run message shown in this tab (FR-015). */
  error?: string
  /**
   * True while a default-surface request is outstanding for THIS tab (the Jira
   * my-tickets default-view fetch) — per-tab so one loading tab keeps its skeleton
   * even while another tab already has a surface (new-tab-base-view-v1 FR-008/FR-009).
   * Cleared when any surface or error lands in this tab. Optional: only Jira sets it;
   * Slack/Confluence/Generated UI tabs never carry it.
   */
  loadingDefault?: boolean
  /**
   * True while a TAB-SWITCH auto-refresh is outstanding for THIS tab (jira-tab-switch-auto-
   * refresh-v1). Set when a bound surface is RE-activated (switch-back remounts its A2UI host,
   * discarding its live data) so the parent fires a one-shot `adapter.refresh`; gates the
   * DATA-REGION loading skeleton while the fresh `updateDataModel` is in flight, then cleared
   * when a surface/error frame lands (same render-subscription path that clears
   * `loadingDefault`). Per-tab so a sibling tab's auto-refresh never drives the active tab's
   * skeleton (FR-011). Optional: only Jira sets it; Slack/Confluence/Generated UI tabs never
   * carry it (Jira-only, target-agnostic mechanism wired only here in v1).
   */
  autoRefreshing?: boolean
  /**
   * True when this tab's surface came from a user compose (a solicited render frame
   * correlated via `originatingTabIdRef`), as opposed to an unsolicited deterministic
   * push (Jira's default board / search results / ticket detail). Lets a panel tell a
   * generated-UI surface apart from a native data view — e.g. Jira hides its JQL search
   * box on composed surfaces but keeps it for ticket browsing. Session-only.
   */
  composed?: boolean
  /**
   * True once the user manually renamed this tab (tab-rename-v1 FR-007). A renamed
   * tab keeps its custom label — the generative auto-relabel path below
   * (`labelFromUtterance` on the originating utterance) skips it (FR-008). Session-only
   * (FR-017), like every other tab field.
   */
  renamed?: boolean
  /**
   * The bound surface's SECRET-FREE adapter descriptor (jira-generative-adapter-v1,
   * FR-006). Present only for a bound surface; lets a refresh/restore re-execute the
   * descriptor for fresh data. Persisted beside the composed spec + restored on
   * hydrate. Carries no token/secret (FR-007/FR-021). Session-only otherwise.
   */
  descriptor?: AdapterDescriptor
  /**
   * The PARTITIONED surface's per-container {@link AdapterBinding}s (refreshable-custom-
   * generative-ui multi-region). Present only for a multi-region bound surface; persisted
   * beside the composed spec + restored on hydrate so a refresh re-registers every region.
   * Mutually exclusive with {@link descriptor}. No token/secret. Session-only otherwise.
   */
  bindings?: AdapterBinding[]
  /**
   * The Google Calendar legend's HIDDEN (deselected) calendar ids for THIS tab
   * (calendar-selection-persistence). PER-TAB so each google-calendar tab keeps its own
   * selection. The panel reads the active tab's set, renders the legend against it, and
   * writes back via `update(id, { hiddenCalendars })` on every toggle so it persists into
   * this tab's `GenerativeTabSnapshot.hiddenCalendars` and rehydrates on restore. Non-secret
   * email-like ids. Only google-calendar tabs ever set it; the other panels never do.
   */
  hiddenCalendars?: string[]
  /**
   * This tab's per-tab "cosmos" glyph id (cosmos-random-tab-icons-v1, FR-002/FR-003). A bounded
   * enum string from the 14-icon set; assigned ONCE at the event-time mint (random) and stable for
   * the tab's life — never recomputed on render. Resolved to a lucide component at the strip's
   * `stripTabs` map + published to the Home tree via `LivePanelTab.iconId`. Mirrors how every other
   * tab field persists (session-only on the live record; `GenerativeTabSnapshot.iconId` is the copy).
   */
  iconId?: TabIconId
}

export interface GenerativePanelTabs extends PanelTabsController<GenerativeTab> {
  /** Submit an utterance, correlating its run to the active/auto-created tab. */
  submit: (utterance: string) => void
  /** Open a fresh "Untitled" tab and make it active (FR-005/FR-009). */
  newTab: () => void
  /**
   * Open a fresh active tab that wants a base/default surface, then fire-or-defer the
   * supplied `request()` (new-tab-base-view-v1 FR-007/FR-011, OQ-1). The opened tab is
   * marked `loadingDefault: true` (its per-tab skeleton). `request()` pushes an
   * UNSOLICITED frame for this panel's `target` (Jira passes
   * `() => window.cosmos.jira.requestDefaultView()`), so it MUST NOT race a solicited
   * compose for the shared `originatingTabIdRef` slot: if the correlation is idle the
   * request fires now; if a compose is awaiting a frame the request is DEFERRED and
   * flushed when that run resolves (and the correlation is idle again). The new tab
   * never hangs — `loadingDefault` + no surface still shows the panel's base.
   * Generic: the hook stays free of Jira specifics beyond the injected `request`.
   */
  newTabWithDefault: (request: () => void) => void
  /**
   * The IN-PLACE analog of `newTabWithDefault` (jira-jql-search-v1 FR-004/FR-006/FR-009):
   * "filter the current tab" rather than open a new one. Marks the ACTIVE tab
   * `loadingDefault: true` + clears its prior error (or, if there is no active tab,
   * auto-creates one marked `loadingDefault` to hold the result), then fires-or-defers the
   * supplied `request()` against the shared `originatingTabIdRef` slot — exactly like
   * `newTabWithDefault` (the two share the private `fireOrDeferDefault` core). `request()`
   * pushes an UNSOLICITED `target` frame (Jira passes
   * `() => window.cosmos.jira.requestSearchView({ jql }))`), so it MUST NOT race a solicited
   * compose: fire now if the correlation is idle, else DEFER until the in-flight run
   * resolves. The landed surface (or a Notice) clears `loadingDefault` via the render
   * subscription.
   */
  requestDefaultInActiveTab: (request: () => void) => void
  /**
   * jira-ticket-detail-v1 (#86, R-A; FR-009): fire-or-defer an UNSOLICITED-frame request
   * against the shared `originatingTabIdRef` slot WITHOUT touching any tab's loading state.
   * `requestDefaultInActiveTab` marks the active tab `loadingDefault` (its LIST skeleton),
   * which is wrong for the ticket-detail read — that frame is routed away into the dock slot
   * by `onUnsolicitedFrame`, so it never clears `loadingDefault` (the list would hang in a
   * skeleton). The dock has its OWN loading (`detailSurface == null`), so the detail read
   * only needs the fire-or-defer discipline, not the list-skeleton flag. Fires now when the
   * correlation is idle, else defers and flushes when the in-flight run resolves.
   */
  fireOrDefer: (request: () => void) => void
  /** Close a tab, cancelling any unresolved blocking surface + dropping correlation. */
  closeTab: (tabId: string) => void
  /**
   * True while a user compose is awaiting its render frame (the shared `originatingTabIdRef`
   * slot is non-null), recomputed each render (jira-kanban-generation-v1 Symptom 1). A panel's
   * default-load effect reads this to AVOID racing a pending compose: `submit()` sets the
   * originating ref synchronously BEFORE the later `ui:generatingBegin` spinner signal arrives,
   * so for the window between submit and that signal an empty tab still looks idle (`inFlight`
   * is no longer set optimistically) — `inCompose` is the only flag that is already true there.
   * It flips back to false when the frame lands or the run errors (both null the ref).
   */
  inCompose: boolean
}

export interface GenerativePanelTabsOptions {
  /** This panel's render target — only matching `ui:render` frames are filed. */
  target: UiRenderTarget
  /**
   * This panel's display name (e.g. "Jira", "Generated UI"). Seeds the unified tab
   * label for a not-yet-composed tab via `panelTabLabel`: the bare name for the first
   * tab, then "<Panel> N" for later tabs. A compose then relabels from its utterance.
   */
  panelName: string
  /**
   * Whether a `generated-ui`-style blocking surface should be cancelled when its tab
   * is closed. Only `'generated-ui'` keeps blocking in main (CLAUDE.md); the other
   * targets are settled immediately by `UiBridge`, so closing their tabs needs no
   * cancel. Defaults to `false`.
   */
  cancelOnClose?: boolean
  /**
   * session-persistence-v1 (FR-008/FR-012): the restored panel slice to seed the tab
   * collection + the monotonic `everOpened` counter from. Composed surfaces are
   * re-instated with a FRESH requestId (FR-013); live-data views were never persisted
   * (FR-015). Absent for a clean session.
   */
  initial?: GenerativePanelSnapshot
  /**
   * jira-ticket-detail-v1 (#86, approach R-A): an optional interceptor for UNSOLICITED
   * frames (a `ui:render` for this panel's `target` that no submit was awaiting). When
   * supplied, every unsolicited frame is offered to it FIRST; if it returns `true` the
   * frame is considered consumed and is NOT filed into the active tab's `surface` — the
   * panel routes it elsewhere (Jira routes its `jira:requestIssueDetail` detail frame
   * into a per-tab dock slot so the list surface is never clobbered). Returning `false`
   * (or omitting the option) falls through to the normal active-tab filing. SOLICITED
   * frames (a compose's awaited answer) are never offered to it. Generic: the hook stays
   * free of Jira specifics — it only asks "did the panel take this unsolicited frame?".
   */
  onUnsolicitedFrame?: (payload: UiRenderPayload) => boolean
  /**
   * open-prompt-view-context-v1 (FR-004/FR-011): an optional provider that returns the
   * active panel's current non-secret {@link ViewContext} (the open ticket/channel/thread/
   * page/event) read from the state the panel ALREADY holds. Called at SEND time inside
   * `submit()` so the context reflects what is on screen when Enter is pressed (Edge Cases:
   * selection may change while the composer is open). Best-effort + non-blocking: if it
   * throws or returns undefined, submit proceeds WITHOUT a viewContext (FR-005/FR-011).
   * The generic Generated-UI panel omits it (FR-003 — no panel selection).
   */
  getViewContext?: () => ViewContext | undefined
}

/**
 * Returns the tab controller plus `submit`/`newTab`/`closeTab` wired to the
 * originating-tab correlation. The component renders the strip + the active tab's
 * provider and calls these handlers.
 */
export function useGenerativePanelTabs(
  options: GenerativePanelTabsOptions
): GenerativePanelTabs {
  const { target, panelName, cancelOnClose = false, initial, onUnsolicitedFrame, getViewContext } =
    options
  // Read the unsolicited-frame interceptor through a ref so the long-lived render
  // subscription never re-subscribes when the panel passes a fresh closure each render.
  const onUnsolicitedFrameRef = useRef<GenerativePanelTabsOptions['onUnsolicitedFrame']>(
    onUnsolicitedFrame
  )
  onUnsolicitedFrameRef.current = onUnsolicitedFrame
  // open-prompt-view-context-v1: read the view-context provider through a ref so `submit`
  // stays a stable callback while always invoking the LATEST closure at SEND time (the
  // panel passes a fresh closure each render that closes over its current selection).
  const getViewContextRef = useRef<GenerativePanelTabsOptions['getViewContext']>(getViewContext)
  getViewContextRef.current = getViewContext
  // session-persistence-v1: seed the collection from the restored slice (composed
  // surfaces re-instated with a fresh requestId — FR-013). PURE lazy initializer, so a
  // StrictMode double-invoke is idempotent (mintRequestId returns fresh ids, but the
  // initializer result is taken once by useState).
  const controller = usePanelTabs<GenerativeTab>(
    initial ? hydrateGenerativeTabs(initial, () => crypto.randomUUID()) : undefined
  )
  const { tabs, activeTabId, open, close, update } = controller

  // Monotonic count of tabs ever opened in THIS panel, for the unified seed-tab label
  // (first tab = bare panel name, then "<Panel> N"). Like the Terminal counter it does
  // not renumber on close. Advanced only from event handlers / the seed effect — never
  // render-phase — so React StrictMode's render double-invoke cannot double-advance it.
  // Seeded from the restored counter so a new `+` after restore never collides (FR-010).
  const everOpenedRef = useRef(
    initial ? seedEverOpenedFrom(initial.everOpened, initial.tabs.length) : 0
  )
  // session-persistence-v1 (FR-007/FR-012): report this panel's contribution to the
  // debounced save coordinator on every tab-state change. Only composed surfaces are
  // persisted (buildGenerativePanel strips the rest). `target` is one of the four
  // generative panel keys. Reads `everOpenedRef.current` at report time (the counter
  // is event-advanced, so it is current here).
  const report = useReportPanel()
  useEffect(() => {
    report(
      target as GenerativePanelKey,
      buildGenerativePanel({ tabs, activeTabId }, everOpenedRef.current)
    )
  }, [tabs, activeTabId, target, report])

  // cosmos-panel-tab-list-v1 (FR-008/FR-009): publish this panel's FULL live tab list into the
  // App-root PanelTabsProvider so the Cosmos tree can survey it. This is NOT the lossy persistence
  // `buildGenerativePanel` path — it carries EVERY open tab's non-secret { id, label } + the active
  // id (FR-011). The four generative panels' `target` IS the cross-panel id; the generic Cosmos
  // wire target `'generated-ui'` publishes nothing (the Cosmos panel is excluded from its own tree).
  const panelTabsPanelId: CrossPanelId | null = target === 'generated-ui' ? null : target
  const livePanelTabs = useMemo<LivePanelTabs | null>(
    () =>
      panelTabsPanelId === null
        ? null
        : {
            // cosmos-favorite-live-panel-portal-v1: the published tab is LABEL-ONLY ({id,label}). A
            // Home favorite of a generative panel no longer reads a published surface — it renders the
            // LIVE source panel itself (reparented via the panel-host portal). The tree consumer
            // (`toPanelTabGroups`) only needs {id,label}, and favorite GONE detection is by tab
            // EXISTENCE in this list. (No `surface`/`mirrorSurface` — those evolutions are superseded.)
            // cosmos-random-tab-icons-v1 (FR-012): carry the per-tab glyph id so the Cosmos tree's
            // leaf row shows the SAME glyph as the panel strip. Renderer-only NON-SECRET ref pass
            // (like `serialize`); never persisted/IPC on this path.
            tabs: tabs.map((t) => ({
              id: t.id,
              label: t.label,
              ...(t.iconId ? { iconId: t.iconId } : {})
            })),
            activeTabId
          },
    [panelTabsPanelId, tabs, activeTabId]
  )
  usePublishPanelTabs(panelTabsPanelId, livePanelTabs)

  // cosmos-tree-tab-rename-delete-v1 (FR-002/FR-004/FR-005): publish this panel's REVERSE tab
  // commands so the Cosmos tree can drive Rename/Delete on a source tab. Bound to the EXISTING stable
  // `update`/`close` ops: rename sets `{ label, renamed: true }` (so `shouldApplyAutoLabel` then skips
  // the generative auto-relabel, FR-004); delete is the same path as the strip `X`. STABLE object
  // (memoized on the stable `update`/`close` useCallbacks) so it publishes once, not every render. The
  // cosmos wire target `'generated-ui'` (panelTabsPanelId === null) publishes nothing.
  const tabCommands = useMemo<TabCommands | null>(
    () =>
      panelTabsPanelId === null
        ? null
        : {
            onRename: (id, label) => update(id, { label, renamed: true }),
            onClose: (id) => close(id)
          },
    [panelTabsPanelId, update, close]
  )
  usePublishTabCommands(panelTabsPanelId, tabCommands)

  // cosmos-context-chip-crosspanel-and-historical-v1 (#2): record the captured PromptContext for
  // each submit into the App-root shared ref so the Cosmos timeline's live seed reflects THIS panel
  // (Jira/Slack/Confluence/Calendar), not a stale cosmos-only default. Stable setter (writes a ref).
  const recordSubmitContext = useRecordSubmitContext()

  const mintLabel = useCallback(
    () => panelTabLabel(panelName, (everOpenedRef.current += 1)),
    [panelName]
  )

  // The tab that was active at submit time — where the next ui:render (and any
  // error) for this target must land, even after a tab switch (FR-013/FR-015).
  const originatingTabIdRef = useRef<string | null>(null)
  // Latest tab ids + active id, read inside subscriptions without re-subscribing.
  const tabIdsRef = useRef<Set<string>>(new Set())
  tabIdsRef.current = new Set(tabs.map((t) => t.id))
  // Latest tab records by id, so the render subscription can consult a tab's `renamed`
  // flag (tab-rename-v1 FR-008) without re-subscribing on every tab change.
  const tabsByIdRef = useRef<Map<string, GenerativeTab>>(new Map())
  tabsByIdRef.current = new Map(tabs.map((t) => [t.id, t]))
  const activeTabIdRef = useRef<string | null>(activeTabId)
  activeTabIdRef.current = activeTabId
  // Each in-flight tab's utterance, so the surface frame (no utterance) can derive
  // the tab label (FR-010) when it lands.
  const pendingUtteranceRef = useRef<Map<string, string>>(new Map())
  // A default-surface request (new-tab-base-view-v1 OQ-1) deferred because a compose
  // was awaiting a frame when `newTabWithDefault` ran. Single-slot: the latest
  // deferred request wins (only one default request is meaningful at a time — the
  // most recently opened default-loading tab). Flushed when an in-flight run resolves
  // and the correlation is idle (see the `agent:status` subscription below).
  const deferredDefaultRequestRef = useRef<(() => void) | null>(null)

  // Panel-level ui:render subscription: file the frame into the originating tab
  // (FR-013/FR-019), or discard if that tab was closed (FR-027). An UNSOLICITED frame
  // (no pending originating tab — e.g. Jira's default view or a jira.* write re-push,
  // FR-020) lands in the currently active tab, or auto-creates a tab if none exists.
  useEffect(() => {
    const off = window.cosmos.ui.onRender((payload: UiRenderPayload) => {
      if (payload.target !== target) {
        return
      }
      let tabId = originatingTabIdRef.current
      originatingTabIdRef.current = null
      // A solicited frame (one a submit was awaiting) is a composed surface; an
      // unsolicited push (default board / search / detail) is a native data view.
      const wasSolicited = tabId !== null

      if (tabId) {
        // Solicited: a submit is awaiting this frame.
        if (!tabIdsRef.current.has(tabId)) {
          return // FR-027: originating tab closed — discard.
        }
      } else {
        // jira-ticket-detail-v1 (#86, R-A): offer an UNSOLICITED frame to the panel's
        // interceptor first. If it takes the frame (e.g. Jira routes its detail frame to
        // a per-tab dock slot), do NOT file it into the active tab's surface — the list
        // surface is never clobbered. A solicited (compose) frame is never offered.
        if (onUnsolicitedFrameRef.current?.(payload) === true) {
          return
        }
        // Unsolicited (Jira default view / write re-push, FR-019/FR-020): land in the
        // active tab; if there are zero tabs, auto-create one to hold it.
        tabId = activeTabIdRef.current
        if (!tabId || !tabIdsRef.current.has(tabId)) {
          const id = crypto.randomUUID()
          open({
            id,
            label: mintLabel(),
            untitled: true,
            // cosmos-random-tab-icons-v1 (FR-002): assign at the event-time mint (this
            // subscription callback is an event, never render).
            iconId: randomTabIconId(),
            surface: {
              requestId: payload.requestId,
              spec: payload.spec,
              dataModel: payload.dataModel,
              descriptor: payload.descriptor,
              bindings: payload.bindings
            },
            inFlight: false,
            composed: false,
            // jira-generative-adapter-v1 (FR-006): carry the bound surface's descriptor
            // onto the tab so refresh/restore can re-execute it. Undefined for non-bound.
            // multi-region: bindings carry the per-container descriptors instead.
            descriptor: payload.descriptor,
            bindings: payload.bindings
          })
          return
        }
      }

      const utterance = pendingUtteranceRef.current.get(tabId)
      pendingUtteranceRef.current.delete(tabId)
      // tab-rename-v1 FR-008: a manually-renamed tab keeps its custom label — skip the
      // auto-relabel (label + untitled) while still updating surface/inFlight/error.
      const applyAutoLabel = shouldApplyAutoLabel(tabsByIdRef.current.get(tabId))
      update(tabId, {
        surface: {
          requestId: payload.requestId,
          spec: payload.spec,
          dataModel: payload.dataModel,
          descriptor: payload.descriptor,
          bindings: payload.bindings
        },
        // FR-010: derive the label from the originating utterance (solicited only),
        // unless the tab was manually renamed (tab-rename-v1 FR-008).
        ...(utterance && applyAutoLabel
          ? { label: labelFromUtterance(utterance), untitled: false }
          : {}),
        inFlight: false,
        error: undefined,
        // new-tab-base-view-v1 FR-008/FR-010: a landed surface (default board OR a
        // recoverable Notice) clears this tab's default-loading skeleton.
        loadingDefault: false,
        // jira-tab-switch-auto-refresh-v1 (FR-008): a landed surface/Notice also clears the
        // tab-switch auto-refresh skeleton so it is replaced by the repainted surface (and
        // never hangs on a failed refresh). Per-tab, like loadingDefault.
        autoRefreshing: false,
        // Mark composed vs. native data view so panels (Jira) can hide compose-only
        // chrome on generated surfaces while keeping it for ticket browsing.
        composed: wasSolicited,
        // jira-generative-adapter-v1 (FR-006): carry/clear the bound descriptor onto
        // the tab (a non-bound surface clears any stale one). multi-region: bindings
        // carry the per-container descriptors instead (each clears the other).
        descriptor: payload.descriptor,
        bindings: payload.bindings
      })
    })
    return off
    // stable: update/open/mintLabel are useCallback; reads go through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, open, update, mintLabel])

  // Panel-level agent:status:
  //  - on `error`: surface the failure in the originating tab (FR-015) + clear the
  //    correlation.
  //  - on `error`/`completed`: flush any DEFERRED default-surface request once the
  //    in-flight run resolves and the correlation is idle again (new-tab-base-view-v1
  //    FR-011, OQ-1). The error bookkeeping runs FIRST so `originatingTabIdRef` is
  //    null by the time we test whether to flush.
  useEffect(() => {
    const off = window.cosmos.agent.onStatus((status: AgentStatusPayload) => {
      if (status.state === 'error') {
        const tabId = originatingTabIdRef.current
        originatingTabIdRef.current = null
        if (tabId && tabIdsRef.current.has(tabId)) {
          pendingUtteranceRef.current.delete(tabId)
          update(tabId, { inFlight: false, error: status.message ?? 'The run failed.' })
        }
      }
      // open-prompt-spinner-gating-v1 (FR-004 — the root-cause fix): a `completed` run that
      // produced NO `generated-ui` surface (a plain command) must release the originating
      // tab; otherwise its `inFlight` (set unconditionally at submit) leaves the panel stuck
      // on the "Generating…" spinner forever. A true UI-generation run's surface already
      // landed via `ui:render` (clearing `inFlight` + `originatingTabIdRef`), so this is a
      // no-op for it. `producedSurface` makes the no-surface release deterministic; absent ⇒
      // fall back to surface-presence (shouldReleaseInFlightOnCompleted, FR-008). Clears the
      // correlation BEFORE the deferred-default flush below (which reads it idle).
      if (status.state === 'completed') {
        const tabId = originatingTabIdRef.current
        if (tabId && tabIdsRef.current.has(tabId)) {
          const tab = tabsByIdRef.current.get(tabId)
          if (
            shouldReleaseInFlightOnCompleted({
              inFlight: tab?.inFlight === true,
              hasSurface: tab?.surface != null,
              producedSurface: status.producedSurface
            })
          ) {
            originatingTabIdRef.current = null
            pendingUtteranceRef.current.delete(tabId)
            update(tabId, { inFlight: false })
          }
        }
      }
      // A run resolved — try to flush a deferred default request. Only fire when a
      // request is queued AND the correlation is now idle (a second compose may have
      // started in between → stay deferred, never hang the tab — the new tab still
      // shows its base because loadingDefault + no surface → base).
      if (status.state === 'completed' || status.state === 'error') {
        if (
          shouldFlushDeferredDefault(
            deferredDefaultRequestRef.current !== null,
            originatingTabIdRef.current
          )
        ) {
          const request = deferredDefaultRequestRef.current
          deferredDefaultRequestRef.current = null
          request?.()
        }
      }
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update])

  // ui-catalog-pull-spinner-signal-v1 (FR-005/FR-008): the EARLY "UI generation has begun"
  // begin-signal subscription. When a `ui:generatingBegin` for THIS panel's `target` arrives —
  // the run pulled `get_ui_catalog`, so it WILL generate UI — turn the originating tab's
  // per-tab spinner ON (gating it on this signal instead of optimistically at submit). The
  // signal correlates to the same single-run `originatingTabIdRef` slot as `ui:render`; if that
  // tab was closed (or the begin-signal came from the interactive PTY with no originating tab),
  // it is safely DISCARDED (FR-008). IDEMPOTENT: a second begin-signal on an already-in-flight
  // tab is a no-op. The `ui:render` land + `completed`/`error` release are unchanged stop
  // conditions. Reads correlation/tab state through refs so it never re-subscribes.
  useEffect(() => {
    const off = window.cosmos.ui.onGeneratingBegin((payload) => {
      if (payload.target !== target) {
        return
      }
      const tabId = originatingTabIdRef.current
      // No originating tab (interactive PTY pull, or a plain run that never submitted through
      // this panel) ⇒ discard. A closed originating tab ⇒ discard (FR-008).
      if (!tabId || !tabIdsRef.current.has(tabId)) {
        return
      }
      // Idempotent: only engage if not already in-flight (avoid a redundant state write).
      if (tabsByIdRef.current.get(tabId)?.inFlight === true) {
        return
      }
      update(tabId, { inFlight: true })
    })
    return off
    // stable: update is useCallback; correlation + tab reads go through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, update])

  const submit = useCallback(
    (utterance: string, options?: { contextDismiss?: 'none' | 'thread' | 'all' }) => {
      // FR-012 / FR-012a: fill the active tab, or auto-create the first tab when zero.
      let targetTabId = activeTabId
      // ui-catalog-pull-spinner-signal-v1 (FR-005/FR-006): submit no longer optimistically spins.
      // `inFlightOnSubmit()` now returns `false` — the per-tab spinner is gated on the EARLY
      // `ui:generatingBegin` begin-signal (the `get_ui_catalog` pull), turned ON by the
      // subscription above when this run pulls the catalog. A plain MCP/command run never pulls
      // the catalog, so it never spins. The `ui:render` land + `completed`/`error` release remain
      // the stop conditions. We STILL set `originatingTabIdRef`/`pendingUtteranceRef` below so the
      // begin-signal and the surface can both find the originating tab.
      const inFlight = inFlightOnSubmit()
      if (!targetTabId) {
        const id = crypto.randomUUID()
        open({
          id,
          label: labelFromUtterance(utterance),
          untitled: false,
          iconId: randomTabIconId(), // cosmos-random-tab-icons-v1 (FR-002): event-time mint.
          surface: null,
          inFlight
        })
        targetTabId = id
      } else {
        // FR-014: drop any prior error and CLEAR the prior surface so the panel blanks until
        // the new surface lands. Safe for every target: a blocking `generated-ui` surface can
        // only be re-submitted over once its run has completed (the single-run guard blocks
        // submit while it awaits an action), and the other targets settle immediately, so no
        // pending call is orphaned. `inFlight` is gated by `inFlightOnSubmit()` (see above).
        update(targetTabId, { inFlight, error: undefined, surface: null })
      }
      originatingTabIdRef.current = targetTabId
      pendingUtteranceRef.current.set(targetTabId, utterance)
      // open-prompt-view-context-v1 (FR-004/FR-011): capture the active panel's current
      // view context LIVE at send time so it reflects what is on screen now (Edge Cases).
      // Best-effort + non-blocking: a thrown/undefined provider submits without context.
      let viewContext: ViewContext | undefined
      try {
        viewContext = getViewContextRef.current?.()
      } catch {
        viewContext = undefined
      }
      // Apply the composer chip's dismiss choice (design §5): 'all' drops the whole context
      // for this submit; 'thread' drops only the Slack thread dimension (the channel rides on).
      const dismiss = options?.contextDismiss ?? 'none'
      if (dismiss === 'all') {
        viewContext = undefined
      } else if (dismiss === 'thread' && viewContext?.threadTs) {
        const { threadTs: _dropped, ...rest } = viewContext
        viewContext = rest
      }
      // cosmos-timeline-prompt-context-v1 (FR-001..FR-007): capture the PromptContext ONCE from
      // data the hook already holds — panel (target === SurfaceId for these 4 panels) + active tab
      // + the (dismiss-applied) dock viewContext tagged with its kind. The builder feeds it to BOTH
      // channels (the marker AND the unchanged `viewContext` grounding) from this one object.
      const panelId = target as PromptPanelId
      const activeTab = tabs.find((t) => t.id === activeTabId)
      const promptContext: PromptContext = {
        panel: { id: panelId, label: panelName },
        ...(activeTab ? { tab: { id: activeTab.id, label: activeTab.label } } : {})
      }
      const dockKind = DOCK_KIND_BY_PANEL[panelId]
      if (viewContext && dockKind) {
        promptContext.dock = { kind: dockKind, ...viewContext }
      }
      // cosmos-context-chip-crosspanel-and-historical-v1 (#2): publish this submit's context so the
      // Cosmos timeline's `agent:status 'started'` live seed reads it and the in-flight chip names
      // THIS panel. Written synchronously BEFORE submit, so the later 'started' reads the right value.
      recordSubmitContext(promptContext)
      window.cosmos.agent.submit(buildAgentSubmitWithMarker(utterance, target, promptContext))
    },
    [activeTabId, open, update, target, tabs, panelName, recordSubmitContext]
  )

  const newTab = useCallback(() => {
    // FR-005/FR-009: a `+`-created tab shows the unified panel-name label until it
    // composes (first tab = bare panel name, then "<Panel> N").
    open({
      id: crypto.randomUUID(),
      label: mintLabel(),
      untitled: true,
      iconId: randomTabIconId(), // cosmos-random-tab-icons-v1 (FR-002): event-time mint.
      surface: null,
      inFlight: false
    })
  }, [open, mintLabel])

  // The shared fire-or-defer core of `newTabWithDefault`/`requestDefaultInActiveTab`
  // (new-tab-base-view-v1 OQ-1 / FR-011; jira-jql-search-v1 FR-009): `request()` pushes an
  // UNSOLICITED frame for this panel's `target`, so fire it NOW only if no compose is
  // awaiting a frame, else DEFER until the in-flight run resolves — the two frame kinds
  // must never race the shared `originatingTabIdRef` slot. The loading tab never hangs:
  // loadingDefault + no surface still shows the panel's base. Stateless beyond the refs.
  const fireOrDeferDefault = useCallback((request: () => void) => {
    if (defaultRequestDecision(originatingTabIdRef.current) === 'fire') {
      request()
    } else {
      deferredDefaultRequestRef.current = request
    }
  }, [])

  const newTabWithDefault = useCallback(
    (request: () => void) => {
      // Open a fresh active tab that wants a base/default surface, marked
      // `loadingDefault` for its per-tab skeleton (FR-008/FR-009).
      open({
        id: crypto.randomUUID(),
        label: mintLabel(),
        untitled: true,
        iconId: randomTabIconId(), // cosmos-random-tab-icons-v1 (FR-002): event-time mint.
        surface: null,
        inFlight: false,
        loadingDefault: true
      })
      fireOrDeferDefault(request)
    },
    [open, fireOrDeferDefault, mintLabel]
  )

  const requestDefaultInActiveTab = useCallback(
    (request: () => void) => {
      // jira-jql-search-v1 FR-004/FR-006: "filter the current tab". Mark the ACTIVE tab
      // loadingDefault + clear its prior error so its per-tab skeleton shows while the
      // read is outstanding; if there is no active tab (zero tabs), auto-create one to
      // hold the result (FR-004). Then fire-or-defer the unsolicited frame exactly like
      // `newTabWithDefault` (shared core).
      const activeId = activeTabIdRef.current
      if (activeId && tabIdsRef.current.has(activeId)) {
        update(activeId, { loadingDefault: true, error: undefined })
      } else {
        open({
          id: crypto.randomUUID(),
          label: mintLabel(),
          untitled: true,
          surface: null,
          inFlight: false,
          loadingDefault: true
        })
      }
      fireOrDeferDefault(request)
    },
    [open, update, fireOrDeferDefault, mintLabel]
  )

  const closeTab = useCallback(
    (tabId: string) => {
      const closing = tabs.find((t) => t.id === tabId)
      // A 'generated-ui' render_ui call BLOCKS in main awaiting the user's action;
      // closing its tab must resolve that pending call cancel so the run never hangs
      // (render-ui-v1 FR-009; a stale requestId is ignored in main). Other targets are
      // settled immediately by UiBridge, so no cancel is needed (cancelOnClose=false).
      if (cancelOnClose && closing?.surface && !closing.surface.error) {
        window.cosmos.ui.sendAction({
          requestId: closing.surface.requestId,
          action: { type: 'cancel' }
        })
      }
      if (originatingTabIdRef.current === tabId) {
        originatingTabIdRef.current = null // FR-027: drop correlation for a closed tab.
      }
      pendingUtteranceRef.current.delete(tabId)
      close(tabId)
    },
    [tabs, close, cancelOnClose]
  )

  // jira-kanban-generation-v1 (Symptom 1): recompute the compose-in-flight signal on EVERY
  // render so a consumer effect re-reads it after a submit re-renders the panel. Timing: a
  // compose's `submit()` calls `open`/`update` (which queue a state update → re-render) and
  // THEN sets `originatingTabIdRef.current = targetTabId` synchronously, before that re-render
  // runs. React flushes the queued state update only after the event handler returns, so by the
  // time this render-phase read executes the ref is already non-null. A plain ref read at render
  // is therefore correct here (no extra state needed): the value the consumer's effect sees on
  // the submit-triggered render reflects the just-set correlation. It returns to false when the
  // frame lands or the run errors (the subscriptions null the ref, then `update` re-renders).
  const inCompose = originatingTabIdRef.current !== null

  return {
    ...controller,
    submit,
    newTab,
    newTabWithDefault,
    requestDefaultInActiveTab,
    fireOrDefer: fireOrDeferDefault,
    closeTab,
    inCompose
  }
}
