# Bug: a Google Calendar Home favorite shows "Waiting for this tab's view…" forever

- **id:** calendar-favorite-waiting-v1
- **area:** renderer — Home favorites / native-view mirror / Google Calendar panel
- **severity:** medium (favorite unusable for calendar; calm-but-wrong WAITING state, never recovers)
- **status:** FIXED (renderer-only; non-secret)

## Symptom

A GOOGLE CALENDAR tab pinned as a Home favorite renders the WAITING placeholder
("Waiting for this tab's view…") forever instead of mirroring the month/week view. The
recent native-view-mirror feature (cosmos-native-view-mirror-surface-v1) fixed this for
Confluence + Slack but did NOT cover google-calendar.

## Root cause (the REAL one — NOT the favorite/mirror seam)

`FavoriteSurface` resolves `mirrorSurface ?? surface` for the live source tab and shows
WAITING only when BOTH are null. The user sees WAITING (not the GONE "no longer open"
state), so `favoriteCatalogHosts['google-calendar']` exists (it does — `favoriteCatalogHosts.tsx`
includes a google-calendar host) and the live tab is found, but its published `surface`
is null.

Investigation of the three candidates:

1. **Is the calendar's pushed surface routed AWAY from `tab.surface`?** NO. `GoogleCalendarPanel`
   passes NO `onUnsolicitedFrame` interceptor to `useGenerativePanelTabs`
   (`GoogleCalendarPanel.tsx:256-273`), so the unsolicited `target:'google-calendar'`
   default-view frame IS filed into the active tab's `surface` by the shared hook
   (`useGenerativePanelTabs.ts` render subscription, the `else`/active-tab branch). The
   `livePanelProjection` publishes that `surface`, and the favorite mirrors it. The seam is
   FINE — this is NOT a Confluence/Slack-style "native React, never writes a TabSurface" gap,
   so NO `buildCalendarMirror` is needed (the calendar's surface IS the thing to mirror).

2. **Is the host present + correct?** YES (`favoriteCatalogHosts.tsx:59-63`). So once a surface
   exists the favorite renders POPULATED (proven by the regression test, and by the generic
   `ConfluenceFavoriteWaiting` Test A which exercises the same generic publish path).

3. **THE ACTUAL CAUSE — the default-view FETCH is gated on `active`.**
   `GoogleCalendarPanel.tsx` only fires `requestDefaultView()` when the panel is the
   visible rail surface (`active === true`):

   ```
   if (active && isConnected && activeTab && !activeTab.surface && …) {
     requestDefaultInActiveTab(() => window.cosmos.googleCalendar.requestDefaultView())
   }
   ```

   The live default view is `composed:false`, so session-persistence does NOT persist it
   (`sessionSnapshot.buildGenerativeTab` keeps `surface` only when `composed === true`); it
   re-fetches on restore. After a restart (or for any never-activated tab), the restored
   calendar tab hydrates with `surface: null` (`hydrateGenerativeTabs`), and while the user
   sits in Home the calendar panel is mounted-but-HIDDEN (`active === false`, all panels are
   `forceMount`ed — `App.tsx`). So the fetch NEVER fires → `tab.surface` stays null → the
   published `LivePanelTab.surface` is null → the favorite waits forever.

   This is the same END RESULT as the Confluence/Slack gap (the favorite has no surface to
   mirror) but a DIFFERENT mechanism: not "native React never writes a surface", but
   "active-gated fetch never runs while the source is hidden behind Home".

## Fix (minimal; reuses existing infra)

`src/renderer/calendar/GoogleCalendarPanel.tsx` — also fetch the default view when the active
tab is PINNED as a Home favorite, reusing the existing reverse pinned-sources channel (the
OQ-3 gate Confluence/Slack already use):

```ts
const pins = usePinnedSources()
const isActivePinned =
  activeTabId != null && pins.has(pinnedSourceKey('google-calendar', activeTabId))
// gate: (active || isActivePinned) && isConnected && activeTab && !activeTab.surface && …
```

So a hidden-but-pinned calendar tab eager-reads its default view → the pushed frame fills
`tab.surface` → it publishes → the favorite mirrors it (POPULATED). A non-pinned hidden tab
still does NOT eager-read (the pre-fix policy is preserved for the common case), so the change
is narrowly scoped to tabs a favorite points at. No new builder, no `nativeMirror` branch, no
new IPC/contract — the calendar's own surface IS the mirror.

## Regression test (jsdom) — RED→GREEN

`src/renderer/cosmos/CalendarFavoriteWaiting.dom.test.tsx` (sibling of
`ConfluenceFavoriteWaiting.dom.test.tsx`). Drives the REAL `GoogleCalendarPanel`
(`active={false}`, connected, a RESTORED tab `g1` with NO surface — the post-restart state)
plus a real `FavoriteSurface` for that tab; `requestDefaultView` is mocked to push a
`google-calendar` `ui:render` frame. `ActiveTabSurface` is stubbed to print its `surfaceId`.

- **Test A (the fix):** pin `google-calendar:g1` → the hidden tab fetches → the favorite shows
  `google-calendar-default-view` (POPULATED), NOT WAITING. **RED before** the gate change
  (favorite shows "Waiting for this tab's view…", `requestDefaultView` never called); **GREEN
  after**.
- **Test B (no regression):** unpinned hidden tab → never fetches → favorite stays WAITING.
  Green both before and after (the pre-fix policy for non-pinned tabs is preserved).

## Verification

- `npm run typecheck` — green
- `npm test` (node) — green
- `npm run test:dom` — green (incl. the new file + the existing favorite/mirror suites)
- Manual (`npm run dev`, NOT exercised in CI): connect Google Calendar, open a calendar tab,
  pin it as a Home favorite, restart the app, go straight to Home → the favorite shows the
  month/week view instead of the WAITING placeholder.

## Notes

- NON-SECRET: the calendar default-view surface is the existing secret-free `EventList`
  projection (`googleCalendarSurfaceBuilder.buildSharedViewSurface`) — never a token/path.
- No overlap with the concurrent `SharedComposer.tsx` Home-footer fix (different files).
