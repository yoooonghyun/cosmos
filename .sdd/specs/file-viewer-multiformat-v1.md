# Spec: Multi-Format File Viewer — v1

**Status**: Draft
**Created**: 2026-06-27
**Supersedes**: (extends `terminal-file-explorer-v1` + `terminal-file-tabs-v1` — does not replace them)
**Related plan**: `.sdd/plans/file-viewer-multiformat-v1.md`

---

## Grounding

> Direct investigation performed by the architect for this spec (mandatory report).

**codegraph_explore queries run:**
- `installLocalFileProtocol cosmos-file protocol file explorer viewer Monaco useExplorerPanes fileExplorer open file` → the `cosmos-file://` handler (`localFileProtocol.ts`) is **image-only today**: it returns a 415 broken-image Response for any non-image extension (`if (!isImageExtension(ref.relPath)) return brokenImageResponse(415)`). The handler already does paneId→root resolution + `pathConfine` real-path confinement + streaming with no size cap and never throws.
- `FileViewer component fileKind isImageExtension classifyFile FsReadResult fs:read updateOpenFile localFileSrc` → `FileViewer.tsx`'s `ViewerBody` is a `switch (viewer.kind)` over `ViewerState` (`loading|text|image|binary|denied|not-found`); `text`→`MonacoText`, `image`→`ImageView` (`<img src={buildLocalFileSrc(paneId, relPath)}>`). `fileKind.ts` (`classifyFile`/`isImageExtension`/`looksLikeText`/`extensionOf`) is the PURE, node-testable classification point. Binary today → calm "Preview not available" block.
- `FsReadResult FsReadOk FsReadError fs:read handler fsExplorer readFile buildLocalFileSrc localFileSrc COSMOS_FILE_SCHEME ImageView MonacoText` → `fsExplorer.read()` reads bytes, calls `classifyFile`, returns `{ok:true,kind:'text',text}` / `{ok:true,kind:'image'}` marker / `{ok:false,reason:'binary'}`. `FsReadResult` (`src/shared/ipc/fs.ts`) is the typed contract; `buildLocalFileSrc(paneId, relPath)` (`localFileSrc.ts`) is the pure renderer-side opaque-URL builder.

**memory_recall / memory_smart_search queries run:**
- `file explorer viewer monaco cosmos-file image protocol terminal split` → recovered the two design/impl memories for `terminal-file-explorer-v1` (#84): Monaco via `?worker` (auto-bundled, no electron.vite change), `cosmos-file://` privileged scheme mirroring the confluence/slack proxies (register before `app.ready`, confine via `pathConfine`, never throw, add to CSP `img-src`), no file size cap (a deliberate #84 call), reuse-don't-hand-roll preference (chose Monaco over a hand-rolled text viewer). Takeaway: this feature must extend those exact patterns, not invent new ones.
- `file viewer multi-format pdf docx xlsx office binary preview` → no prior results; this is net-new direction.

**Package research (npm registry + upstream READMEs, all verified current as of 2026-06-27, all render LOCALLY with no cloud service):**
- `pdfjs-dist` — latest 6.0.227, **Apache-2.0**; the canonical Mozilla pdf.js engine; renders fully locally; needs the `pdf.worker` wired.
- `react-pdf` — latest 10.4.1, **MIT**; React wrapper over pdf.js; **pins `pdfjs-dist@5.4.296`** (the 5.x line, not 6.x); peer `react ^19` (satisfied). Worker via `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()` (Vite-native); requires importing `react-pdf/dist/Page/AnnotationLayer.css` + `TextLayer.css`.
- `docx-preview` — latest 0.3.7, **Apache-2.0**; `renderAsync(blob|ArrayBuffer|Uint8Array, container)` → high-fidelity DOM; one dep (`jszip`); fully local.
- `mammoth` — latest 1.12.0, **BSD-2-Clause**; docx → simplified HTML (lower fidelity).
- `xlsx` (SheetJS) — npm-registry latest **0.18.5**, **Apache-2.0** (newer SheetJS releases moved to the SheetJS CDN; 0.18.5 is the last npm-published build and is sufficient for read-only parsing). `XLSX.read(arrayBuffer, {type:'array'})` + `XLSX.utils.sheet_to_html(ws)` → standalone HTML `<table>` per sheet; fully local.
- `@cyntler/react-doc-viewer` — 1.17.1, Apache-2.0; **REJECTED**: only PDF/CSV render natively; DOCX/XLSX fall back to remote/MS-Office-Online viewers, which **violates the local-only / no-network constraint** (CLAUDE.md). Per-format renderers are used instead.

---

## Overview

Today the Terminal File Explorer's middle viewer column (`terminal-file-explorer-v1` /
`terminal-file-tabs-v1`) previews exactly two things: UTF-8 **text/code** (read-only Monaco)
and a handful of **image** types (`<img>` over the `cosmos-file://` scheme). Everything else —
PDF, Word, Excel, and other common documents — falls into the calm "Preview not available"
binary block. This feature turns the editor into a **multi-format read-only viewer**: a user who
clicks a PDF, DOCX, or XLSX in the file tree sees it rendered in place, alongside images and code,
with everything served **locally** from the existing `cosmos-file://` confinement envelope (no
network, no cloud document service, no token exposure). It is **read-only** (viewing, not editing
office files) and **renderer-first** — it adds new renderer dependencies and a viewer registry, but
introduces no agent/MCP/A2UI surface and no new arbitrary-filesystem IPC.

---

## User Scenarios

### View a PDF in the file explorer · P1

**As a** cosmos user browsing a repo's files
**I want to** click a `.pdf` in the tree and read it inline
**So that** I can review a document without leaving the app or exporting it elsewhere

**Acceptance criteria:**
- Given a live terminal tab with a folder open, when I click a `report.pdf` row, then a PDF viewer renders the document's pages inside the middle viewer column.
- Given a multi-page PDF, when it renders, then I can scroll through all pages (continuous or paged) within the viewer.
- Given the PDF is rendered, when I inspect network traffic, then NO request leaves the machine — the bytes came from `cosmos-file://`.

### View a Word document (DOCX) · P1

**As a** user
**I want to** click a `.docx` and read its formatted content inline
**So that** I can review a spec/contract/notes file without Word

**Acceptance criteria:**
- Given a `.docx` file, when I click it, then its formatted content (headings, paragraphs, lists, tables, inline styles) renders in the viewer with reasonable fidelity.
- Given a `.doc` (legacy binary Word, not OOXML), when I click it, then the viewer shows the graceful "no preview" fallback (not a crash) — legacy `.doc` is out of scope.

### View a spreadsheet (XLSX) · P1

**As a** user
**I want to** click an `.xlsx`/`.xls` and read its cells inline
**So that** I can inspect tabular data without Excel

**Acceptance criteria:**
- Given an `.xlsx` workbook, when I click it, then the first sheet renders as a read-only grid/table of cells.
- Given a multi-sheet workbook, when it renders, then I can switch between sheets (e.g. a sheet selector) and each sheet's cells display read-only.

### View images and code as before · P1

**As a** user
**I want** images and text/code to keep working exactly as they do now
**So that** the enhancement adds formats without regressing the existing two

**Acceptance criteria:**
- Given a supported image (`png/jpg/jpeg/gif/webp/svg/bmp/ico`), when I click it, then it renders via `<img>` over `cosmos-file://` exactly as today.
- Given a UTF-8 text/code file, when I click it, then read-only Monaco renders it exactly as today (same theme, soft-wrap, model-swap behavior).

### Graceful fallback for unsupported / unpreviewable files · P1

**As a** user
**I want** an unknown or truly-binary file to degrade calmly
**So that** clicking a random binary never crashes or blanks the viewer

**Acceptance criteria:**
- Given a file whose type has no registered viewer (e.g. `.zip`, `.bin`, an unknown extension that sniffs binary), when I click it, then the viewer shows a calm "No preview available" block (NOT a red error) consistent with the existing binary state.
- Given any registered viewer fails to render a corrupt/malformed file of its own type, when the failure occurs, then the viewer shows a calm "Couldn't open this file" state and the rest of the explorer keeps working.

### Loading and error states · P2

**As a** user
**I want** clear feedback while a large document parses
**So that** a slow render does not look like a hang

**Acceptance criteria:**
- Given a document that takes time to fetch+parse, when it is loading, then the viewer shows a calm loading affordance (consistent with the existing `loading` state) until it renders or errors.
- Given a file above the configured size cap for its format, when I click it, then the viewer shows a calm "File too large to preview" state with the file name (and does not attempt to load the whole document into memory).

### Multi-format tabs coexist · P2

**As a** user with several files open in the viewer tab strip
**I want** each open tab to remember its own format/content
**So that** switching between a PDF tab, a code tab, and a sheet tab is seamless

**Acceptance criteria:**
- Given a PDF, a `.ts`, and an `.xlsx` each open in the file-tab strip, when I switch between their tabs, then each renders its own format without re-reading or bleeding into a sibling tab.
- Given a watched folder change (`fs:changed`), when an open document file changes on disk, then its tab re-reads and re-renders; a vanished one shows the existing calm "no longer available" state.

---

## Functional Requirements

| ID     | Requirement |
|--------|-------------|
| FR-001 | The viewer MUST render **PDF** files (`.pdf`) inline, page-by-page, fully locally (no network/cloud service). |
| FR-002 | The viewer MUST render **DOCX** files (`.docx`) inline as formatted content (headings, paragraphs, lists, tables, basic inline styles), fully locally. |
| FR-003 | The viewer MUST render **XLSX/XLS** workbooks (`.xlsx`, `.xls`) inline as a read-only grid/table, with a way to switch between sheets when a workbook has more than one. |
| FR-004 | The viewer MUST keep rendering **images** and **text/code** exactly as the current explorer does (no regression to the existing `image` and `text` paths). |
| FR-005 | The system MUST select the renderer by a **viewer registry** keyed on the file's extension (and, for ambiguous/extension-less files, the existing text-vs-binary byte sniff), with a single deterministic routing decision per file. |
| FR-006 | A file with no registered viewer, or that fails the text sniff and is not a registered format, MUST degrade to a calm **"No preview available"** fallback (consistent with the current binary block), never a crash or blank. |
| FR-007 | Every document renderer MUST receive its bytes via the existing **`cosmos-file://`** confinement envelope (paneId→root resolution + `pathConfine` real-path confinement) — either as a URL the library fetches (pdf.js) or as an `ArrayBuffer` the renderer fetches from that URL and hands to the library (docx-preview, SheetJS). It MUST NOT introduce a new arbitrary-filesystem IPC channel or send absolute paths to the renderer. |
| FR-008 | The viewer MUST expose, per open file, the states: **loading**, **rendered**, **unsupported** (no viewer), **error** (corrupt/failed render), and **too-large** (over the per-format size cap). The existing **denied** / **not-found** states MUST be preserved. |
| FR-009 | The viewer MUST be **read-only** for all formats — no editing/saving of PDF/DOCX/XLSX content in v1. |
| FR-010 | No secret or token MUST ever reach any document renderer, the `cosmos-file://` bytes, or any viewer surface (the scheme already carries no token; this MUST remain true). |
| FR-011 | The viewer-routing decision (extension/mime → viewer kind) MUST live in **pure, node-testable** logic (no DOM/Electron import), mirroring the existing `fileKind.ts` `.ts`/`.test.ts` split. |
| FR-012 | Each document format MAY enforce a **size cap** (a per-format byte ceiling) above which it shows the `too-large` state instead of loading — distinct from the existing text/image path, which deliberately has NO cap. The cap value(s) are a plan-level decision. |
| FR-013 | Adding any new bundled **worker** (pdf.js) MUST be wired so it loads in both `npm run dev` and the packaged build, and the renderer **CSP** MUST permit the renderer to `fetch` `cosmos-file://` bytes and run the worker, or the feature silently fails. |
| FR-014 | The feature MUST NOT change the existing `fs:*` IPC contract semantics, the `cosmos-file://` confinement/security model, the watcher, or the file-tab-strip behavior — it extends the `cosmos-file://` handler to stream non-image in-root files and extends the viewer registry only. |
| FR-015 | The viewer SHOULD treat **Markdown** (`.md`) and **CSV** as text in v1 (rendered in Monaco / as text), with rich Markdown preview and a richer CSV grid explicitly DEFERRED (not in v1). |
| FR-016 | **PPTX**, legacy binary **`.doc`/`.ppt`**, and other office/binary formats without a chosen v1 renderer MUST fall through to the `unsupported` fallback (FR-006); they are explicitly deferred. |

## Edge Cases & Constraints

- **`cosmos-file://` is image-only today.** The handler returns 415 for any non-image extension. v1 MUST relax that gate so the same confined, never-throwing, no-token handler can stream PDF/DOCX/XLSX (and other in-root) bytes — preserving the confinement, the broken-stream-not-crash discipline, and the no-token guarantee. (Whether this is a relaxed extension allowlist on the existing authority or a sibling authority is a plan decision; security envelope is unchanged either way.)
- **CSP fetch gate.** The renderer CSP currently has no explicit `connect-src`, so it inherits `default-src 'self'` — a `fetch('cosmos-file://…')` from docx-preview/SheetJS (and pdf.js, which fetches internally) is **blocked** until `cosmos-file:` is allowed for connections. The pdf.js worker must be permitted by `worker-src` (same-origin bundled asset is covered by `'self'`; a blob worker by `blob:`). This is a load-bearing wiring detail, not optional.
- **react-pdf pins `pdfjs-dist@5.4.296`.** Choosing `react-pdf` brings the 5.x pdf.js line (not the standalone 6.x). Using raw `pdfjs-dist` directly would allow 6.x but means hand-wiring page rendering. The plan picks one; mixing two pdf.js majors MUST be avoided.
- **Legacy binary formats are out of scope.** `.doc` (pre-OOXML Word), `.ppt`, and `.pages`/`.numbers`/`.key` are NOT rendered in v1 — they take the `unsupported` fallback.
- **SVG** stays on the existing image path (it is already in `IMAGE_EXTENSIONS`); it is not re-routed to a document renderer.
- **No editing.** Office editing, form-fill, annotation, or save-back is explicitly out of scope (would be a far larger spec).
- **No remote document services.** Any library or wrapper that offloads rendering to Google Docs Viewer / MS Office Online / a hosted converter is forbidden — everything renders client-side from local bytes. (`@cyntler/react-doc-viewer` is rejected for this reason.)
- **Bundle size.** Document renderers (pdf.js especially) add meaningful weight; acceptable for a disk-loaded desktop app, consistent with the Monaco-barrel precedent.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | Clicking a `.pdf`, `.docx`, and `.xlsx` each renders the document inline in the viewer; images and text/code still render unchanged. |
| SC-002 | With the OS network offline, all four document formats + images + code still render (proves local-only). |
| SC-003 | Clicking a `.zip`/`.bin`/unknown-binary file shows the calm "No preview available" fallback; a corrupt `.pdf`/`.docx`/`.xlsx` shows the calm "Couldn't open this file" state — neither crashes or blanks the viewer or affects sibling tabs. |
| SC-004 | The extension→viewer routing is covered by node-tests (pure module, no DOM), and `npm run typecheck` + `npm test` pass. |
| SC-005 | The pdf.js worker loads in both `npm run dev` and a packaged `npm run build` (no "worker not found" / silent blank), and the renderer can `fetch` `cosmos-file://` bytes under CSP. |
| SC-006 | A document above its format's size cap shows the calm "File too large to preview" state instead of loading. |

---

## Open Questions

- [ ] **PDF library choice — confirm direction.** The spec recommends **`react-pdf` 10.4.1 (MIT, pins `pdfjs-dist@5.4.296`)** for the fastest, React-idiomatic integration (it handles page layout, text/annotation layers, the `new URL(..., import.meta.url)` worker pattern). The alternative is raw **`pdfjs-dist` 6.0.227 (Apache-2.0)** with a hand-rolled page-canvas loop (newer engine, more control, more code). Recommendation: **react-pdf** unless you specifically want the 6.x engine. Confirm.
- [ ] **Size caps.** Default proposal: PDF ~50 MB, DOCX ~25 MB, XLSX ~15 MB (parse-into-memory formats get a cap; text/image keep none). Confirm or adjust — or decide v1 ships with NO document cap (simplest, matching the existing no-cap stance) and defer caps. The plan can ship either way.
- [ ] **CSV/Markdown depth.** v1 treats `.csv`/`.md` as plain text in Monaco (FR-015). Confirm that a rich Markdown preview and a CSV grid are acceptable to DEFER, or pull one into v1.
