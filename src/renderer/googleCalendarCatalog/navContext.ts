/**
 * CalendarNavContext — the seam that injects PANEL-level month/year navigation into the
 * catalog's `EventList`/`CalendarMonthGrid` (calendar-month-year-nav-v1).
 *
 * The catalog components are rendered by the A2UI `A2UIRenderer` from the surface JSON, so
 * the panel cannot pass them React props directly (their props come from the surface node).
 * Instead the panel wraps its live-default-view `A2UIProvider` in this context Provider;
 * the grid reads it to render the nav cluster in place of the plain `<h2>` label.
 *
 * Context is non-null ONLY for the live default view (`composed: false`, connected). A
 * composed snapshot or a not-connected state renders WITHOUT the provider, so the grid
 * falls back to the plain label and offers no navigation (FR-016 / FR-017).
 *
 * Renderer-only: nothing here is persisted or crosses IPC. The intent + handlers live in
 * `GoogleCalendarPanel`; this is purely the delivery channel.
 */

import { createContext, useContext } from 'react'

/* ------------------------------------------------------------------------- *
 * CalendarDetailContext — delivers the open-detail dock's CURRENT event id into the
 * catalog so the matching `EventChip` reads `selected` (calendar-event-detail-v1 FR-003).
 *
 * Unlike `CalendarNavContext` (live default view only), this is provided whenever the
 * panel is connected — a composed snapshot's chips are clickable too. The OPEN action is
 * a plain `useDispatchAction` in `EventList` (no delivery needed); only the selected
 * MARKER flows down here. Renderer-only; nothing crosses IPC.
 * ------------------------------------------------------------------------- */

/** The id of the event the detail dock is currently showing, or null when the dock is closed. */
export const CalendarDetailContext = createContext<string | null>(null)

/** Read the open-detail dock's current event id (the chip selected marker), or null. */
export function useCalendarDetailSelectedId(): string | null {
  return useContext(CalendarDetailContext)
}

/** The active default-view granularity (calendar-week-day-views-v1). */
export type CalendarViewKind = 'month' | 'week' | 'day'

export interface CalendarNavValue {
  /**
   * The active view (calendar-week-day-views-v1, FR-001). The header renders the view
   * switcher + chooses the nav cluster: Month shows the double+single chevrons + month label;
   * Week/Day show single-step chevrons + the range/day label. Defaults to `'month'` for the
   * month-only callers' shape.
   */
  view: CalendarViewKind
  /** Switch the active view (Month/Week/Day). Re-issues the default-view request. */
  onSelectView: (view: CalendarViewKind) => void
  /**
   * The header LABEL for the active view: the month label (`June 2026`), the week range
   * (`June 14 – 20, 2026`), or the day (`Thursday, June 18, 2026`). Panel-composed so the
   * label always matches the requested anchor (not re-derived from the surface window).
   */
  rangeLabel: string
  /** false ⇒ the displayed range is already current ⇒ "Today" is a disabled no-op. */
  canGoToday: boolean
  /** Single-step PREVIOUS: prev month / prev week / prev day per the active view. */
  onPrev: () => void
  /** Single-step NEXT: next month / next week / next day per the active view. */
  onNext: () => void
  /** Jump back to the current range (month/week/day); a no-op when already current. */
  onToday: () => void
  /** Month-only year jump (prev). Undefined for week/day (the header hides the double chevrons). */
  onPrevYear?: () => void
  /** Month-only year jump (next). Undefined for week/day. */
  onNextYear?: () => void
}

/** Null when the grid is NOT the live default view (composed snapshot / disconnected). */
export const CalendarNavContext = createContext<CalendarNavValue | null>(null)

/** Read the panel-injected nav wiring, or `null` when navigation is not offered. */
export function useCalendarNav(): CalendarNavValue | null {
  return useContext(CalendarNavContext)
}

/* ------------------------------------------------------------------------- *
 * CalendarVisibilityContext — the panel-injected, PERSISTED hidden-calendar set
 * (calendar-selection-persistence).
 *
 * The catalog's `EventList` used to own the hidden-set as per-surface `useState`. That
 * state remounted on every view navigation (Month↔Week↔Day re-issues the default-view
 * request → a fresh surface → a fresh `EventList` → the set re-seeded from Google's
 * `selected`, discarding the user's toggles) AND never persisted (it reset on restart).
 *
 * The PANEL now owns the set (seeded from the persisted session snapshot, reported back
 * on every toggle) and injects it here for the live default view. Non-null ⇒ `EventList`
 * reads/writes THIS set (survives the remount, persists). Null (composed snapshot /
 * disconnected / agent-MCP path) ⇒ `EventList` falls back to its own ephemeral local
 * state, byte-for-byte the old behavior. Renderer-only; the set crosses IPC only as the
 * non-secret `hiddenCalendars` string[] in the session snapshot.
 * ------------------------------------------------------------------------- */

/** The panel-injected hidden-set + its toggle, or null when not the live default view. */
export interface CalendarVisibilityValue {
  /** The currently HIDDEN calendar ids (a deselected calendar's events are dropped). */
  hidden: Set<string>
  /** Flip one calendar id between shown/hidden; the panel persists the new set. */
  onToggle: (id: string) => void
}

/** Null when the grid is NOT the live default view (composed snapshot / disconnected). */
export const CalendarVisibilityContext = createContext<CalendarVisibilityValue | null>(null)

/** Read the panel-injected persisted hidden-set wiring, or `null` when not offered. */
export function useCalendarVisibility(): CalendarVisibilityValue | null {
  return useContext(CalendarVisibilityContext)
}
