/**
 * panelTabs — pure, framework-free tab-collection logic for the per-panel
 * VS Code-style tab strips (panel-tabs v1, Track B / Phase 3).
 *
 * This module is intentionally React-free and DOM-free so it can be unit-tested
 * in vitest's node env (no jsdom) — the catalog convention in CLAUDE.md ("keep
 * testable logic in a plain `.ts`, never import a `.tsx` from a `.test.ts`").
 * `usePanelTabs.ts` wraps these in a React hook; `PanelTabStrip.tsx` renders.
 *
 * Spec trace (.sdd/specs/panel-tabs-v1.md):
 *   FR-005  openTab — `+` opens a new tab and makes it active.
 *   FR-006  closeTab — closing the ACTIVE tab activates an adjacent tab
 *           (right-else-left, the VS Code rule).
 *   FR-007  closeTab — closing a NON-active tab leaves the active tab unchanged.
 *   FR-009  labelForUntitled — a `+`-created, not-yet-composed tab reads "Untitled".
 *   FR-010  labelFromUtterance — a composed generative tab's label is derived
 *           from the originating utterance, truncated to fit the strip.
 *   FR-011  terminalLabel — a Terminal tab reads "Terminal N" (1-based index).
 */

/** The minimal shape every tab record shares — a stable id. */
export interface TabLike {
  id: string
}

/** The default label for a `+`-created, not-yet-composed generative tab (FR-009). */
export const UNTITLED_LABEL = 'Untitled'

/**
 * Max characters of an utterance kept in a derived tab label before truncation
 * (FR-010). The visual ellipsis (`max-w-[16rem]` + CSS `truncate`) is the strip's
 * job; this is a defensive content-level cap so an enormous utterance never bloats
 * the in-memory label or the native `title`/tooltip. Chosen to comfortably exceed
 * what the 16rem column shows so the CSS ellipsis remains the visible truncation.
 */
export const MAX_LABEL_LENGTH = 60

/**
 * The result of an open/close operation on a tab collection: the next ordered
 * tab list plus the next active id (null when the collection is now empty —
 * FR-016/017/018 for generative panels; never reached for Terminal, FR-024).
 */
export interface TabsState<T extends TabLike> {
  tabs: T[]
  activeTabId: string | null
}

/**
 * Append a new tab and make it active (FR-005). Pure: returns a fresh state, does
 * not mutate the input. The caller supplies the fully-formed tab record (id +
 * whatever per-panel fields it carries) so this stays generic over tab kind.
 *
 * Invalid input (a missing/duplicate id) must NOT throw — it warns and returns a
 * safe fallback (the unchanged state) so a misuse never crashes a panel (SDD
 * Step 4: invalid required arg warns + safe fallback).
 */
export function openTab<T extends TabLike>(
  state: TabsState<T>,
  tab: T,
  warn: (msg: string) => void = console.warn
): TabsState<T> {
  if (!tab || typeof tab.id !== 'string' || tab.id === '') {
    warn('[panelTabs] openTab: tab is missing a non-empty string id; ignoring')
    return state
  }
  if (state.tabs.some((t) => t.id === tab.id)) {
    warn(`[panelTabs] openTab: a tab with id "${tab.id}" is already open; ignoring`)
    return state
  }
  return { tabs: [...state.tabs, tab], activeTabId: tab.id }
}

/**
 * Pick the id that should become active after `closedId` is removed from `tabs`,
 * GIVEN the current `activeId` (FR-006/FR-007). The list passed in is the list
 * BEFORE removal so adjacency is computed against the original positions.
 *
 *  - Closing a NON-active tab → active is unchanged (FR-007).
 *  - Closing the ACTIVE tab → the tab to its right, else (if it was the rightmost)
 *    the tab to its left; null when it was the only tab (FR-006).
 */
export function adjacentActiveId<T extends TabLike>(
  tabs: T[],
  closedId: string,
  activeId: string | null
): string | null {
  // FR-007: closing a non-active tab does not move the active tab.
  if (closedId !== activeId) {
    return activeId
  }
  const index = tabs.findIndex((t) => t.id === closedId)
  if (index === -1) {
    // Closed id not present — leave active as-is (defensive).
    return activeId
  }
  // FR-006: prefer the right neighbor, else the left neighbor, else none.
  const right = tabs[index + 1]
  if (right) {
    return right.id
  }
  const left = tabs[index - 1]
  if (left) {
    return left.id
  }
  return null
}

/**
 * Remove `closedId` from the collection and re-pick the active tab per the
 * adjacent-activation rule (FR-004/FR-006/FR-007). Pure; returns a fresh state.
 *
 * Closing a tab not in the collection (or an empty/invalid id) is a no-op that
 * warns and returns the unchanged state (safe fallback).
 */
export function closeTab<T extends TabLike>(
  state: TabsState<T>,
  closedId: string,
  warn: (msg: string) => void = console.warn
): TabsState<T> {
  if (typeof closedId !== 'string' || closedId === '') {
    warn('[panelTabs] closeTab: closedId must be a non-empty string; ignoring')
    return state
  }
  if (!state.tabs.some((t) => t.id === closedId)) {
    warn(`[panelTabs] closeTab: no open tab with id "${closedId}"; ignoring`)
    return state
  }
  const nextActive = adjacentActiveId(state.tabs, closedId, state.activeTabId)
  return {
    tabs: state.tabs.filter((t) => t.id !== closedId),
    activeTabId: nextActive
  }
}

/**
 * Make `tabId` the active tab (FR-003). Pure; returns a fresh state. Activating a
 * tab not in the collection is a no-op that warns (safe fallback).
 */
export function setActiveTab<T extends TabLike>(
  state: TabsState<T>,
  tabId: string,
  warn: (msg: string) => void = console.warn
): TabsState<T> {
  if (!state.tabs.some((t) => t.id === tabId)) {
    warn(`[panelTabs] setActiveTab: no open tab with id "${tabId}"; ignoring`)
    return state
  }
  if (state.activeTabId === tabId) {
    return state
  }
  return { ...state, activeTabId: tabId }
}

/**
 * Patch a single tab's record in place within the ordered list (FR-013/FR-014/
 * FR-015: file a surface / set in-flight / set error into the originating tab).
 * Pure; returns a fresh state with that tab merged with `patch`. The patch may
 * omit any field (a partial) — a missing optional field is fine and must not
 * error (SDD Step 4: missing optional fields must not error).
 *
 * Patching a tab not in the collection is a no-op that warns and returns the
 * unchanged state — this is the FR-027 "originating tab was closed" path: the
 * surface has no tab to land in and is discarded.
 */
export function updateTab<T extends TabLike>(
  state: TabsState<T>,
  tabId: string,
  patch: Partial<T>,
  warn: (msg: string) => void = console.warn
): TabsState<T> {
  const index = state.tabs.findIndex((t) => t.id === tabId)
  if (index === -1) {
    warn(`[panelTabs] updateTab: no open tab with id "${tabId}"; discarding patch`)
    return state
  }
  const nextTabs = state.tabs.slice()
  // Never let a patch change the id (the id is the stable key).
  nextTabs[index] = { ...nextTabs[index], ...patch, id: nextTabs[index].id }
  return { ...state, tabs: nextTabs }
}

/**
 * Derive a generative tab's label from the originating utterance (FR-010).
 * Collapses internal whitespace and truncates to `MAX_LABEL_LENGTH` with an
 * ellipsis. An empty/whitespace-only/invalid utterance falls back to "Untitled"
 * (FR-009) — a safe fallback, never an empty label.
 */
export function labelFromUtterance(
  utterance: string,
  maxLength: number = MAX_LABEL_LENGTH
): string {
  if (typeof utterance !== 'string') {
    return UNTITLED_LABEL
  }
  const normalized = utterance.replace(/\s+/g, ' ').trim()
  if (normalized === '') {
    return UNTITLED_LABEL
  }
  if (normalized.length <= maxLength) {
    return normalized
  }
  // Reserve one slot for the ellipsis character.
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

/**
 * Decide whether a freshly-opened tab's default-surface request may fire NOW, or
 * must be DEFERRED until the originating-tab correlation is idle
 * (new-tab-base-view-v1 OQ-1 / FR-011). Pure so the decision is node-testable apart
 * from the React hook that owns the `originatingTabIdRef`.
 *
 * The hazard is purely the SHARED `originatingTabIdRef` slot in
 * `useGenerativePanelTabs`: a default-view request pushes an UNSOLICITED
 * `target:'jira'` frame, and a solicited compose and the unsolicited default frame
 * both consume "the next matching `ui:render`". So:
 *   - correlation idle (`originatingTabId === null`) → fire now ('fire').
 *   - a compose is awaiting a frame (`originatingTabId !== null`) → defer ('defer');
 *     the new tab shows its base/skeleton (never hangs) and the request flushes when
 *     the in-flight run resolves AND the correlation is idle again.
 */
export function defaultRequestDecision(
  originatingTabId: string | null
): 'fire' | 'defer' {
  return originatingTabId === null ? 'fire' : 'defer'
}

/**
 * Decide whether a DEFERRED default-surface request may be flushed now (after an
 * in-flight run resolved via `agent:status` `completed`/`error`), given whether a
 * request is queued and whether the correlation is idle
 * (new-tab-base-view-v1 FR-011). Pure / node-testable.
 *
 * Only flush when a request is queued AND the correlation is idle: a second compose
 * may have started in between, in which case we stay deferred (degrade gracefully —
 * the tab still shows its base because `loadingDefault` + no surface → base, never a
 * stuck skeleton; a later resolution or a manual action resolves it).
 */
export function shouldFlushDeferredDefault(
  hasDeferredRequest: boolean,
  originatingTabId: string | null
): boolean {
  return hasDeferredRequest && originatingTabId === null
}

/**
 * The outcome of committing an inline tab rename (tab-rename-v1 FR-005/FR-006/FR-007).
 * `commit: false` ⇒ revert to the pre-edit label and DO NOT mark the tab renamed
 * (the empty/whitespace path). `commit: true` ⇒ apply `label` (the trimmed value)
 * and mark the tab renamed.
 */
export interface RenameCommitDecision {
  commit: boolean
  /** The trimmed label to apply — present only when `commit` is true. */
  label?: string
}

/**
 * Trim a raw rename-input string to the label that would be applied
 * (tab-rename-v1 FR-006). Manual labels are kept verbatim EXCEPT for leading/
 * trailing whitespace — no internal-whitespace collapse and no length cap (the
 * existing CSS `truncate` handles overflow; a manual rename takes no
 * `MAX_LABEL_LENGTH` content cap). A non-string degrades to '' (safe fallback —
 * the caller's `renameCommitDecision` then reverts, never throwing).
 */
export function normalizeRenameInput(raw: string): string {
  if (typeof raw !== 'string') {
    return ''
  }
  return raw.trim()
}

/**
 * Decide whether an inline rename should commit, and to what label
 * (tab-rename-v1 FR-005/FR-006). This is the single tested predicate the strip and
 * the panel callsites consult:
 *   - empty / whitespace-only / non-string ⇒ `{ commit: false }` — revert to the
 *     pre-edit label and DO NOT mark renamed (FR-005; no blank tabs).
 *   - otherwise ⇒ `{ commit: true, label: <trimmed> }` (FR-006). An unchanged-but-
 *     non-empty value still commits and marks renamed (spec edge case: explicit
 *     confirmation of the current name is acceptable).
 * Invalid input never throws — a non-string falls into the revert branch.
 */
export function renameCommitDecision(raw: string): RenameCommitDecision {
  const trimmed = normalizeRenameInput(raw)
  if (trimmed === '') {
    return { commit: false }
  }
  return { commit: true, label: trimmed }
}

/**
 * Whether an automatic label path may apply to `tab` (tab-rename-v1 FR-008/FR-009).
 * Returns false when the tab has been manually renamed — the generative auto-relabel
 * (`labelFromUtterance` application in `useGenerativePanelTabs`) and any future
 * terminal-relabel path consult this so a renamed tab keeps its custom name. A
 * missing/false `renamed` (the common case) ⇒ true (auto-label proceeds normally).
 * Framework-free + null-safe (a missing tab degrades to true — auto-label is the
 * default, the safe fallback).
 */
export function shouldApplyAutoLabel(tab: { renamed?: boolean } | null | undefined): boolean {
  return !(tab && tab.renamed === true)
}

/**
 * The label for a panel tab at a given 1-based creation index: the BARE panel name
 * for the first tab, then "<Panel> N" for N ≥ 2. This is the unified seed-tab naming
 * convention shared by every rail panel (Terminal and the four generative panels) —
 * the first tab reads just the panel's name, subsequent tabs append their index. A
 * non-finite / non-positive index degrades to the bare panel name (safe fallback).
 */
export function panelTabLabel(panelName: string, index: number): string {
  const n = Number.isFinite(index) && index >= 1 ? Math.floor(index) : 1
  return n === 1 ? panelName : `${panelName} ${n}`
}

/**
 * The label for a Terminal tab at a given 1-based index (FR-011): "Terminal" for the
 * first tab, then "Terminal N" for N ≥ 2 (the unified convention via `panelTabLabel`).
 * A non-finite / non-positive index degrades to "Terminal" (safe fallback).
 */
export function terminalLabel(index: number): string {
  return panelTabLabel('Terminal', index)
}

/**
 * The next 1-based Terminal index given the count of terminal tabs that have ever
 * been opened (FR-011). Terminal indices are monotonic at creation time — they do
 * NOT renumber when a middle terminal is closed (VS Code keeps "Terminal 3" even
 * after "Terminal 2" closes), so the caller tracks a monotonically-increasing
 * counter rather than `tabs.length`.
 */
export function nextTerminalIndex(everOpenedCount: number): number {
  const base = Number.isFinite(everOpenedCount) && everOpenedCount >= 0
    ? Math.floor(everOpenedCount)
    : 0
  return base + 1
}

/**
 * The 1-based index of the Terminal panel's SEED tab (FR-024): always 1.
 *
 * This is a PURE constant-valued helper used by the panel's render-phase `useState`
 * seed so the seed never mutates the monotonic `everOpened` counter during render.
 * React StrictMode double-invokes a `useState` lazy initializer in dev to surface
 * impurity; an initializer that advanced the counter (via `nextTerminalIndex`) would
 * advance it twice for the one seed tab, so the first `+` skipped to "Terminal 3"
 * (terminal-tab-index-skip-v1). The counter is the seed index itself (1) and only
 * advances from event handlers / the empty-refill effect — neither of which Strict-
 * Mode double-invokes for this purpose. Keep the seed referentially pure: derive the
 * label via `terminalLabel(seedTerminalIndex())` and initialize the counter to it.
 */
export function seedTerminalIndex(): number {
  return 1
}

/**
 * Seed the monotonic `everOpened` counter from a restored snapshot value
 * (session-persistence-v1, FR-010). PURE + StrictMode-safe — used inside a render-
 * phase `useRef`/`useState` lazy initializer (never mutates anything), so a
 * double-invoke yields the same constant. Floors to at least the restored tab
 * count and a non-negative integer so a new `+` after restore never collides with
 * an existing tab index. A missing/garbage value degrades to `tabCount` (the safe
 * fallback — at least one-per-tab), matching `reconcileEverOpened` in main.
 */
export function seedEverOpenedFrom(everOpened: unknown, tabCount: number): number {
  const safeCount = Number.isFinite(tabCount) && tabCount >= 0 ? Math.floor(tabCount) : 0
  const n = typeof everOpened === 'number' && Number.isFinite(everOpened) ? Math.floor(everOpened) : 0
  return Math.max(safeCount, n < 0 ? 0 : n)
}
