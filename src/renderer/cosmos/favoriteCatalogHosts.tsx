/**
 * favoriteCatalogHosts — the ONE accepted coupling of Home to the four generative-panel catalogs
 * (cosmos-home-favorite-tabs-v1, plan D3). To render a FAVORITE inline as a true LIVE MIRROR, Home
 * mounts the source tab's surface through the SAME `ActiveTabSurface` host the source panel uses,
 * under the source panel's OWN catalog (`catalogId`). This registry maps a favorite's source
 * `panelId` → `{ catalog, catalogId, panelName }`; terminal is absent (not pinnable, FR-040).
 *
 * `favoriteOnAction` swallows the panel-INTERNAL renderer-local navigation actions (Slack
 * open-channel, Jira/Calendar open-detail) — they have no meaning inside Home in v1, so they are
 * marked handled (return `true`) rather than forwarded/mis-routed. Bound/deterministic round-trips
 * (`adapter.*`, `jira.*`) and the terminal-`submit` one-shot semantics are UNCHANGED — they flow
 * through `ActiveTabSurface`/`UiBridge` exactly as in the source panel (no new contract).
 */

import type { Catalog, A2UIAction } from '@a2ui-sdk/react/0.9'
import { jiraCatalog, JIRA_CATALOG_ID } from '../jira/jiraCatalog'
import { slackCatalog, SLACK_CATALOG_ID } from '../slack/slackCatalog'
import { confluenceCatalog, CONFLUENCE_CATALOG_ID } from '../confluence/confluenceCatalog'
import { googleCalendarCatalog, CATALOG_ID as GOOGLE_CALENDAR_CATALOG_ID } from '../calendar/googleCalendarCatalog'
import { JIRA_OPEN_DETAIL_ACTION } from '../jira/jiraCatalog/logic'
import { SLACK_OPEN_CHANNEL_ACTION } from '../slack/slackCatalog/logic'
import { CALENDAR_OPEN_DETAIL_ACTION } from '../calendar/googleCalendarCatalog/eventDetailLogic'
import { RAIL_LABEL } from '../app/railVisibility'
import type { FavoritePanelId } from './cosmosTabs'

/** The A2UI host wiring for one source panel — the catalog + catalogId + a display name. */
export interface FavoriteCatalogHost {
  catalog: Catalog
  catalogId: string
  panelName: string
}

/**
 * The renderer-LOCAL navigation action ids each generative panel handles internally (a tab/dock
 * switch). Inside a Home favorite these have no target, so they are SWALLOWED in v1 (flagged in the
 * plan, Confirm #1). Bound/deterministic actions are NOT in this set, so they still round-trip.
 */
const SWALLOWED_LOCAL_ACTIONS: ReadonlySet<string> = new Set([
  SLACK_OPEN_CHANNEL_ACTION,
  JIRA_OPEN_DETAIL_ACTION,
  CALENDAR_OPEN_DETAIL_ACTION
])

/**
 * The four generative panels' A2UI hosts, keyed by a favorite's source `panelId` (FR-022). PARTIAL:
 * `'terminal'` is intentionally absent (cosmos-terminal-favorite-multiplex-v1) — a terminal favorite
 * is an xterm-multiplex mirror, NOT an A2UI surface, so `FavoriteSurface` branches to its own
 * terminal path BEFORE this lookup and never indexes a terminal host (an absent host ⇒ undefined,
 * already handled by the GONE guard).
 */
export const favoriteCatalogHosts: Partial<Record<FavoritePanelId, FavoriteCatalogHost>> = {
  jira: { catalog: jiraCatalog, catalogId: JIRA_CATALOG_ID, panelName: RAIL_LABEL.jira },
  slack: { catalog: slackCatalog, catalogId: SLACK_CATALOG_ID, panelName: RAIL_LABEL.slack },
  confluence: {
    catalog: confluenceCatalog,
    catalogId: CONFLUENCE_CATALOG_ID,
    panelName: RAIL_LABEL.confluence
  },
  'google-calendar': {
    catalog: googleCalendarCatalog,
    catalogId: GOOGLE_CALENDAR_CATALOG_ID,
    panelName: RAIL_LABEL['google-calendar']
  }
}

/**
 * The `onAction` intercept for a favorite's inline `ActiveTabSurface`: swallow the source panel's
 * renderer-local navigation actions (return `true` = handled, not forwarded); let everything else
 * fall through to the normal `UiBridge` round-trip (return `false`). Stable across renders.
 */
export function favoriteOnAction(action: A2UIAction): boolean {
  return typeof action.name === 'string' && SWALLOWED_LOCAL_ACTIONS.has(action.name)
}
