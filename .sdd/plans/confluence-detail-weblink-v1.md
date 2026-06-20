# Plan: Confluence Page Detail — "Open in Confluence" Web Link — v1

**Status**: Draft
**Created**: 2026-06-20
**Last updated**: 2026-06-20
**Spec**: .sdd/specs/confluence-detail-weblink-v1.md
**Issue**: #87

---

## Grounding

Same direct grounding as the spec (see its Grounding section). Key load-bearing findings:

- **External-browser hand-off already exists, integration-agnostic.** `mainWindow.webContents.setWindowOpenHandler` in `createWindow` (`src/main/index.ts:1620`) routes any in-page `http(s)` `target=_blank` anchor to `shell.openExternal` and returns `{ action: 'deny' }`. Calendar (#85) added it; Confluence reuses it verbatim — **no main-side change**.
- **Calendar's `<a>` idiom** (`src/renderer/googleCalendarCatalog/components.tsx`, ~line 867): `<Button asChild variant="link" size="sm" className="h-auto px-0"><a href={link} target="_blank" rel="noreferrer">Open in Google Calendar<ExternalLink className="size-3.5" aria-hidden /></a></Button>`, wrapped in `{link && (…)}` and a top-border separator. Copy this idiom for Confluence.
- **Calendar enriched the DTO** in the client mapping with `htmlLink` (omit-when-absent) and unit-tested presence + omission. Mirror with a `webUrl?` on `ConfluencePageDetail`.
- **One detail component, two render paths.** Native `PageDetail` (`src/renderer/ConfluencePanel.tsx:260`) reads `detail.*` directly; the gen-UI catalog `PageDetail` (`src/renderer/confluenceCatalog/components.tsx:260`) reads BOUND sub-paths of the single `/page` value seeded by `buildBoundPageDetailSurface` (`src/main/confluenceSurfaceBuilder.ts:147`). The affordance must land in BOTH, plus the bound spec/builder must carry a new bound `webUrl` path.

## Summary

Add an "Open in Confluence" external link to the Confluence page detail by (1) enriching
the existing `getPage` read DTO with a non-secret `webUrl?` assembled from the page
response's `_links.base` + `_links.webui`, omit-when-absent; (2) passing that field through
the bound page-detail surface builder (a new `webUrl` sub-path binding); and (3) rendering
the calendar's external-link `<a target="_blank">` idiom in BOTH the native `PageDetail`
and the gen-UI catalog `PageDetail`, gated on the link's presence. The link rides the
existing `setWindowOpenHandler` → `shell.openExternal` hand-off — **no new IPC channel, no
new scope, no new fetch, no main-process change**. A short designer step fixes the
affordance's visual treatment to match the calendar link before implementation.

## Technical Context

| Item | Value |
|------|-------|
| Language | TypeScript (Electron main + React renderer) |
| Key dependencies | Existing only: shadcn `Button`, `lucide-react` `ExternalLink`, the in-place `setWindowOpenHandler` |
| New IPC / scope / fetch | NONE (FR-006) — rides `getPage` DTO + the existing window-open handler |
| Files to create | `src/main/integrations/confluenceWebUrl.ts` (pure `webUrl` assembler from `_links`) + its `.test.ts` |
| Files to modify | `src/shared/confluence.ts` (add `webUrl?` to `ConfluencePageDetail`), `src/main/integrations/confluenceClient.ts` (`getPage` reads `_links` → `webUrl`), `src/main/confluenceSurfaceBuilder.ts` (bind `webUrl` sub-path on the detail spec/shell), `src/renderer/confluenceCatalog/components.tsx` (`PageDetailNode.webUrl` bound prop + render the link), `src/renderer/ConfluencePanel.tsx` (native `PageDetail` renders the link from `detail.webUrl`), `docs/ARCHITECTURE.md` (record the cross-surface external-link pattern) |

## Web-URL construction (chosen)

**Source/shape**: read the page response's own `_links` object (the v2
`GET /wiki/api/v2/pages/{id}` response carries `_links: { base, webui }`). The canonical
web URL = `_links.base` (absolute, e.g. `https://acme.atlassian.net/wiki`) + `_links.webui`
(relative, e.g. `/spaces/ENG/pages/123/Title`). The pure assembler:

- returns `undefined` if either piece is missing/non-string;
- resolves `webui` against `base` with `new URL(webui, base)` (handles leading slash),
  guards parse failures, and returns the result ONLY if it is an absolute `http(s)` URL;
- never hand-constructs from the cloudId API host (`api.atlassian.com/ex/confluence/<id>`
  is an API host, NOT a user-facing web URL).

`getPage` adds `...(webUrl ? { webUrl } : {})` to the returned `ConfluencePageDetail`
(omit-when-absent, mirroring calendar `htmlLink`). **Does the DTO need enriching? Yes** —
one new optional non-secret field `webUrl?: string` on `ConfluencePageDetail`.

## Design step (required before implementation)

UI-bearing: add a **design** step (designer agent → `.sdd/designs/confluence-detail-weblink-v1.md`).
Scope is narrow: confirm the "Open in Confluence" affordance matches the calendar
"Open in Google Calendar" link exactly — `Button asChild variant="link" size="sm"`,
`ExternalLink` icon, top-border separator, placement in the detail header block — and note
any Confluence-detail layout nuance (the detail header is a title + space chip block; the
link sits below the body or under the header per the calendar pattern). No new tokens or
shadcn components expected (reuses `Button`/`ExternalLink`). Designer owns the visual spec;
build wiring is the developer's.

---

## Implementation Checklist

### Phase 0 — Design

- [ ] Designer produces `.sdd/designs/confluence-detail-weblink-v1.md`: the affordance's
      treatment + placement, matched to the calendar external link. Approve before Phase 1.

### Phase 1 — Interface / contract

- [ ] Read spec; confirm the only open question (web-URL source) is resolved and the
      contract (`webUrl?: string`, omit-when-absent) holds regardless of `_links` shape.
- [ ] Add `webUrl?: string` to `ConfluencePageDetail` in `src/shared/confluence.ts` with a
      doc comment: canonical web-UI page URL, non-secret, absent when unknown.
- [ ] Add `src/main/integrations/confluenceWebUrl.ts`: pure `confluenceWebUrl(links: unknown): string | undefined`
      assembling `base + webui` → absolute `http(s)` URL or `undefined`.
- [ ] Confirm no new IPC channel/scope is added (grep `src/shared/ipc.ts` + scope consts).

### Phase 2 — Testing

- [ ] `confluenceWebUrl.test.ts`: happy path (`base` + relative `webui` → absolute URL);
      missing `base`; missing `webui`; non-string fields; relative-only / unparseable →
      `undefined`; a `javascript:`/`file:` base rejected (non-`http(s)`).
- [ ] `confluenceClient` test: `getPage` mapping carries `webUrl` when `_links` present and
      OMITS the key when absent (mirror the calendar `htmlLink` presence/omission tests).
      Assert no token/secret leaks into the value.
- [ ] `confluenceSurfaceBuilder` test: the bound detail spec binds a `webUrl` sub-path and
      the seed carries the page value's `webUrl` (and is absent when the page lacks it).

### Phase 3 — Implementation

- [ ] `getPage` (`confluenceClient.ts`): read `r.body._links`, call `confluenceWebUrl`, add
      `...(webUrl ? { webUrl } : {})` to the returned detail.
- [ ] `confluenceSurfaceBuilder.ts`: add `webUrl: { path: '${CONFLUENCE_PAGE_PATH}/webUrl' }`
      to BOTH `buildBoundPageDetailSurface` root and `boundPageDetailSpec` (the shell). The
      seed already serializes the whole detail at `/page`, so `webUrl` rides it automatically.
- [ ] Catalog `PageDetail` (`confluenceCatalog/components.tsx`): add `webUrl?: Bound<string>`
      to `PageDetailNode`, resolve via `useBound`, and render the calendar `<a>` idiom gated
      on a non-empty, absolute `http(s)` value. Factor the link into a small shared
      `OpenInConfluenceLink`/`PageDetailExternalLink` so the native panel reuses it verbatim.
- [ ] Native `PageDetail` (`ConfluencePanel.tsx`): render the same shared link component from
      `detail.webUrl` in the detail header block, so native + gen-UI are identical (SC-005).
- [ ] Validate the href is absolute `http(s)` at the render site as a belt-and-suspenders
      guard (FR-010), even though the assembler already enforces it.
- [ ] All tests pass; `npm run typecheck` clean.

### Phase 4 — Docs

- [ ] `docs/ARCHITECTURE.md`: record the **detail-surface external-link pattern** — detail
      DTOs carry an optional non-secret `web URL` enriched from the source read (no new
      fetch/scope/IPC), rendered as a `target=_blank` link routed to `shell.openExternal` by
      the single `setWindowOpenHandler`; calendar `htmlLink` (#85) and Confluence `webUrl`
      (#87) are the first two instances; Jira/Slack to follow. Note it is the SECOND consumer
      of the integration-agnostic window-open handler.
- [ ] Reconcile `TODO.md` (#87) and update this plan's Deviations with any `_links`-shape
      findings from the live response.

---

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **2026-06-20**: Plan authored. Open question (web-URL source) resolved to
  `_links.base + _links.webui` with omit-on-absent fallback; to be confirmed against a live
  v2 response during Phase 2/3 (contract unaffected either way).
