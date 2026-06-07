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

import { useCallback, useEffect, useRef } from 'react'
import type { AgentStatusPayload, UiRenderPayload, UiRenderTarget } from '../shared/ipc'
import { usePanelTabs, type PanelTabsController } from './usePanelTabs'
import {
  defaultRequestDecision,
  labelFromUtterance,
  shouldFlushDeferredDefault,
  UNTITLED_LABEL
} from './panelTabs'

/** A rendered surface stored on a tab: the spec to (re)process + its requestId. */
export interface TabSurface {
  requestId: string
  spec: UiRenderPayload['spec']
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
  /** Close a tab, cancelling any unresolved blocking surface + dropping correlation. */
  closeTab: (tabId: string) => void
}

export interface GenerativePanelTabsOptions {
  /** This panel's render target — only matching `ui:render` frames are filed. */
  target: UiRenderTarget
  /**
   * Whether a `generated-ui`-style blocking surface should be cancelled when its tab
   * is closed. Only `'generated-ui'` keeps blocking in main (CLAUDE.md); the other
   * targets are settled immediately by `UiBridge`, so closing their tabs needs no
   * cancel. Defaults to `false`.
   */
  cancelOnClose?: boolean
}

/**
 * Returns the tab controller plus `submit`/`newTab`/`closeTab` wired to the
 * originating-tab correlation. The component renders the strip + the active tab's
 * provider and calls these handlers.
 */
export function useGenerativePanelTabs(
  options: GenerativePanelTabsOptions
): GenerativePanelTabs {
  const { target, cancelOnClose = false } = options
  const controller = usePanelTabs<GenerativeTab>()
  const { tabs, activeTabId, open, close, update } = controller

  // The tab that was active at submit time — where the next ui:render (and any
  // error) for this target must land, even after a tab switch (FR-013/FR-015).
  const originatingTabIdRef = useRef<string | null>(null)
  // Latest tab ids + active id, read inside subscriptions without re-subscribing.
  const tabIdsRef = useRef<Set<string>>(new Set())
  tabIdsRef.current = new Set(tabs.map((t) => t.id))
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

      if (tabId) {
        // Solicited: a submit is awaiting this frame.
        if (!tabIdsRef.current.has(tabId)) {
          return // FR-027: originating tab closed — discard.
        }
      } else {
        // Unsolicited (Jira default view / write re-push, FR-019/FR-020): land in the
        // active tab; if there are zero tabs, auto-create one to hold it.
        tabId = activeTabIdRef.current
        if (!tabId || !tabIdsRef.current.has(tabId)) {
          const id = crypto.randomUUID()
          open({
            id,
            label: UNTITLED_LABEL,
            untitled: true,
            surface: { requestId: payload.requestId, spec: payload.spec },
            inFlight: false
          })
          return
        }
      }

      const utterance = pendingUtteranceRef.current.get(tabId)
      pendingUtteranceRef.current.delete(tabId)
      update(tabId, {
        surface: { requestId: payload.requestId, spec: payload.spec },
        // FR-010: derive the label from the originating utterance (solicited only).
        ...(utterance ? { label: labelFromUtterance(utterance), untitled: false } : {}),
        inFlight: false,
        error: undefined,
        // new-tab-base-view-v1 FR-008/FR-010: a landed surface (default board OR a
        // recoverable Notice) clears this tab's default-loading skeleton.
        loadingDefault: false
      })
    })
    return off
    // stable: update/open are useCallback; reads go through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, open, update])

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

  const submit = useCallback(
    (utterance: string) => {
      // FR-012 / FR-012a: fill the active tab, or auto-create the first tab when zero.
      let targetTabId = activeTabId
      if (!targetTabId) {
        const id = crypto.randomUUID()
        open({
          id,
          label: labelFromUtterance(utterance),
          untitled: false,
          surface: null,
          inFlight: true
        })
        targetTabId = id
      } else {
        // FR-014: mark the active tab in-flight; drop any prior error.
        update(targetTabId, { inFlight: true, error: undefined })
      }
      originatingTabIdRef.current = targetTabId
      pendingUtteranceRef.current.set(targetTabId, utterance)
      window.cosmos.agent.submit({ utterance, target })
    },
    [activeTabId, open, update, target]
  )

  const newTab = useCallback(() => {
    // FR-005/FR-009: a `+`-created tab is "Untitled" until it composes.
    open({
      id: crypto.randomUUID(),
      label: UNTITLED_LABEL,
      untitled: true,
      surface: null,
      inFlight: false
    })
  }, [open])

  const newTabWithDefault = useCallback(
    (request: () => void) => {
      // Open a fresh active tab that wants a base/default surface, marked
      // `loadingDefault` for its per-tab skeleton (FR-008/FR-009).
      open({
        id: crypto.randomUUID(),
        label: UNTITLED_LABEL,
        untitled: true,
        surface: null,
        inFlight: false,
        loadingDefault: true
      })
      // OQ-1 / FR-011: `request()` pushes an UNSOLICITED frame; fire it now only if no
      // compose is awaiting a frame, else DEFER until the in-flight run resolves so the
      // two frame kinds never race the shared `originatingTabIdRef` slot. The new tab
      // never hangs — loadingDefault + no surface still shows the panel's base.
      if (defaultRequestDecision(originatingTabIdRef.current) === 'fire') {
        request()
      } else {
        deferredDefaultRequestRef.current = request
      }
    },
    [open]
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

  return { ...controller, submit, newTab, newTabWithDefault, closeTab }
}
