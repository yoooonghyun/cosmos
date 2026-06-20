# Spec: Confluence Page Detail — "Open in Confluence" Web Link — v1

**Status**: Draft
**Created**: 2026-06-20
**Supersedes**: —
**Related plan**: .sdd/plans/confluence-detail-weblink-v1.md
**Issue**: #87

---

## Grounding

Direct investigation run for this spec (tools invoked by the architect, not pre-supplied):

- **codegraph_explore** `googleCalendarClient htmlLink GoogleCalendarPanel calendar event detail external link openExternal setWindowOpenHandler` — confirmed the calendar precedent: `EventDetail` renders a plain `<a href target="_blank" rel="noreferrer">Open in Google Calendar</a>` (shadcn `Button asChild variant="link"`), omitted when the link is absent; `htmlLink` is enriched onto the event DTO in the client mapping, omit-when-absent.
- **codegraph_explore** `confluenceClient getPage Confluence page DTO surface builder confluenceCatalog detail` — confirmed `ConfluenceClient.getPage` returns `ConfluencePageDetail { id, title, space?, body }` from the v2 `GET /wiki/api/v2/pages/{id}?body-format=view`; the bound `buildBoundPageDetailSurface` binds `title`/`space`/`body` to sub-paths of a single `/page` value; the native + gen-UI detail share one `PageDetailBody`.
- **memory_recall** `calendar event detail Open in Google Calendar external link htmlLink shell.openExternal setWindowOpenHandler` — recovered calendar-event-detail-v1 (#85): the external link uses NO new IPC; `mainWindow.webContents.setWindowOpenHandler` in `createWindow` routes any `http(s)` `target=_blank` anchor to `shell.openExternal` and denies the in-app child window. This handler is ALREADY in place (`src/main/index.ts:1620`) and is integration-agnostic — Confluence reuses it with zero main-side window changes.
- **Grep** `confluenceApiBase` / `_links` — the client base is `https://api.atlassian.com/ex/confluence/<cloudId>` (an API host, NOT a user-facing web URL). The browser URL must come from the page response's own `_links.base` + `_links.webui`.

---

## Overview

Every detail surface in cosmos should offer a way out to its source web page in the
user's default browser. This feature starts with **Confluence**: when viewing a
Confluence page detail, show an **"Open in Confluence"** affordance that opens the page's
canonical web URL in the system browser. It mirrors the just-shipped calendar
"Open in Google Calendar" link (#85) so the pattern is uniform across detail surfaces.

## User Scenarios

### Open the page on the web · P1

**As a** cosmos user reading a Confluence page detail
**I want to** click an "Open in Confluence" link
**So that** I can view, comment on, or edit the page in the real Confluence web app

**Acceptance criteria:**

- Given a connected Confluence account and an open page detail whose web URL is known,
  when I look at the detail header, then an "Open in Confluence" affordance is visible.
- Given that affordance, when I click it, then the page's canonical Confluence web URL
  opens in my default system browser (a new browser tab/window), NOT inside cosmos.
- Given the affordance, then it appears identically whether I reached the detail via the
  native list, the click-to-open page-detail nav, or a generated-UI (`PageDetail`) surface
  (one shared detail component).

### Degrade when the link is unknown · P1

**As a** cosmos user
**I want to** never see a broken or dead "Open in Confluence" link
**So that** clicking an affordance always does something useful

**Acceptance criteria:**

- Given a page detail whose web URL could not be assembled (the read omitted the link
  fields), when I view the detail, then NO "Open in Confluence" affordance is shown — the
  rest of the detail renders unchanged.
- Given a disconnected / reconnect-needed Confluence account, when the detail cannot be
  read at all, then the normal not-connected / reconnect / error state is shown and there
  is no affordance (there is no page to link to).

---

## Functional Requirements

| ID     | Requirement |
|--------|-------------|
| FR-001 | The Confluence page detail MUST show an "Open in Confluence" affordance when a canonical web URL for the page is available. |
| FR-002 | Activating the affordance MUST open the page's web URL in the user's default system browser, and MUST NOT navigate or open any view inside cosmos. |
| FR-003 | The web URL MUST be the canonical Confluence web-UI page URL (the page as a human would visit it in a browser), assembled from non-secret fields returned by the existing page read. |
| FR-004 | The affordance MUST be omitted (not rendered, not disabled) whenever a web URL cannot be assembled for the page (degrade-to-omit — never a broken link). |
| FR-005 | The same affordance MUST appear on every path that renders the page detail (native page view, click-to-open page-detail nav overlay, and the generated-UI `PageDetail` surface), since all reuse one detail component. |
| FR-006 | The feature MUST be read-only: it adds NO write, NO new OAuth scope, and NO new IPC channel — it rides the existing `getPage` read DTO and the established system-browser hand-off. |
| FR-007 | No token, refresh token, `client_secret`, cloudId-derived secret, or any other secret MAY appear in the web URL, the DTO field carrying it, any IPC/bridge payload, or the rendered surface. The web URL is assembled only from non-secret page-link fields. |
| FR-008 | The web URL field MUST be omitted from the DTO (no `undefined` key) when absent, mirroring the calendar `htmlLink` omit-when-absent discipline, so a bound/static surface never carries an empty value. |
| FR-009 | The affordance MUST be visually consistent with the calendar "Open in Google Calendar" link (same link-button treatment and external-link iconography), so detail surfaces feel uniform. |
| FR-010 | The system MUST only open `http(s)` URLs externally; a non-`http(s)` (e.g. `file:`/`javascript:`) candidate MUST NOT be opened (guaranteed by the existing window-open handler's `http(s)` guard, and by validating the assembled URL is absolute `http(s)` before surfacing it). |

## Edge Cases & Constraints

- **Missing link fields**: the page read returns no usable link material (e.g. `_links`
  absent, or only a relative `webui` with no absolute base) → the web URL is treated as
  absent and the affordance is omitted (FR-004/FR-008).
- **Malformed / relative-only link**: a relative `webui` with no resolvable absolute base,
  or a candidate that does not parse to an absolute `http(s)` URL → treated as absent
  (omit the affordance); never emit a relative or non-`http(s)` href.
- **Disconnected / reconnect_needed / read error**: the detail itself is not shown (its
  existing not-connected/reconnect/error/skeleton states render); no affordance.
- **No body but has link**: a page with an empty body still shows the affordance if its
  web URL is known (the link does not depend on body content).
- **Out of scope for v1**: Jira issue detail, Slack message/thread, and any other detail
  surface. They will follow the SAME pattern in later iterations but are NOT included here.
  No "open in browser" affordance is added to Confluence list rows (this is a detail-only
  affordance). No new "copy link" or share actions.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | On a connected account, opening a real Confluence page detail shows "Open in Confluence"; clicking it opens that exact page in the default browser. |
| SC-002 | A page detail whose read omitted the link fields shows the full detail with NO affordance and no console error. |
| SC-003 | No new IPC channel, no new OAuth scope, and no new network fetch are introduced (verified against `src/shared/ipc.ts`, the Confluence scope constants, and the `getPage` call site). |
| SC-004 | No secret appears in the web URL or its DTO field; the field is omitted when absent (asserted by a client-mapping unit test mirroring the calendar `htmlLink` tests). |
| SC-005 | The native detail and the generated-UI `PageDetail` show the affordance identically (one shared component / one class string). |
| SC-006 | The link opens in the system browser and never inside cosmos (the existing `setWindowOpenHandler` denies the in-app child window). |

---

## Open Questions

- [x] **Which web URL to surface?** Resolved (non-blocking, default chosen): use the page
  read's own `_links.base` + `_links.webui` concatenation (e.g.
  `https://acme.atlassian.net/wiki` + `/spaces/ENG/pages/123/Title` →
  the canonical browser URL). This is what a user gets by clicking the page in Confluence,
  needs no extra fetch, and carries no secret. If the v2 response on the deployed sites does
  not include `_links.base`/`_links.webui` as expected, fall back to omitting the affordance
  (FR-004) rather than hand-constructing a URL from the cloudId API host (which is not a
  user-facing web URL). Confirm the exact `_links` shape against a live v2 response during
  implementation; the contract (`webUrl?: string`, omit-when-absent) does not change either way.
