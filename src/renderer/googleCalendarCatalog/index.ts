/**
 * googleCalendarCatalog — the Google Calendar custom A2UI catalog
 * (`catalogId: 'google-calendar'`), Google Calendar integration v1. A custom `Catalog`
 * value passed to the Google Calendar panel's `<A2UIProvider catalog={googleCalendarCatalog}>`;
 * each panel owns its own catalog (design §1.2 — a catalog is a per-provider prop, not a
 * global registry), so registering these names here never leaks into the other panels.
 *
 * `components` maps each component TYPE NAME (the string the surface JSON's `component`
 * field carries, emitted by `googleCalendarSurfaceBuilder`) to its React component.
 * `functions` is empty (reserved by the SDK). A surface naming a type NOT in this map
 * degrades to the SDK's `UnknownComponent` (warn, no throw) — the panel never
 * white-screens.
 *
 * Component type names (the surface vocabulary) — must match the builder's emitted
 * `component` strings + the `render_google_calendar_ui` MCP vocabulary exactly:
 *   EventList (the default-view root, renders the month grid) · EventRow · Notice ·
 *   Column · Row.
 */

import { standardCatalog, type Catalog } from '@a2ui-sdk/react/0.9'
import { EventList, EventRow, Notice } from './components'

/** The `catalogId` stamped on the Google Calendar panel's `createSurface` envelope. */
export const CATALOG_ID = 'google-calendar'

/**
 * The Google Calendar custom catalog. The `EventList` default-view root (renders the
 * month grid), the standalone `EventRow`, the recoverable `Notice` block, plus the SDK's
 * standard `Column`/`Row` layout passthroughs (design §1.1 permits these) so an
 * agent-emitted grouping root still renders.
 */
export const googleCalendarCatalog: Catalog = {
  components: {
    EventList,
    EventRow,
    Notice,
    Column: standardCatalog.components.Column,
    Row: standardCatalog.components.Row
  },
  functions: {}
}
