# Plan: Multi-Format File Viewer — v1

**Status**: Draft
**Created**: 2026-06-27
**Last updated**: 2026-06-27
**Spec**: `.sdd/specs/file-viewer-multiformat-v1.md`

---

## Grounding

> See the spec's Grounding section for the full codegraph_explore / memory_recall / package-research record. Key facts this plan builds on:
> - `cosmos-file://` handler (`src/main/localFileProtocol.ts`) already does paneId→root + `pathConfine` + streaming + never-throw, but **gates to images only** (415 for non-image). The relaxation point is the `isImageExtension` check.
> - `fileKind.ts` (`classifyFile`/`extensionOf`/`isImageExtension`) is the PURE classification module; `ViewerState` (`src/renderer/fileExplorer/viewerState.ts`) is the per-file state union; `FileViewer.tsx`'s `ViewerBody` is the `switch (viewer.kind)`. These are the extension seams.
> - `FsReadResult` (`src/shared/ipc/fs.ts`) is the typed `fs:read` contract; `fsExplorer.read()` classifies + returns markers. `buildLocalFileSrc(paneId, relPath)` (`localFileSrc.ts`) builds the opaque URL.
> - electron-vite renderer IS Vite: Monaco uses `?worker` (auto-bundled, no config change); pdf.js uses the Vite-native `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)` asset pattern — also no rollup `input` needed (rollup `input` is only for the **main**-process MCP entry scripts).
> - Renderer CSP (`src/renderer/index.html`) has `img-src … cosmos-file:` but **no `connect-src`** → inherits `default-src 'self'`, which blocks `fetch('cosmos-file://…')`. Must add `connect-src 'self' cosmos-file:` (worker already covered by `worker-src 'self' blob:`).

## Summary

Extend the existing read-only file viewer (`terminal-file-explorer-v1` / `terminal-file-tabs-v1`)
from text+image to a **multi-format read-only viewer** by introducing a **pure viewer registry**
that maps a file's extension to a *viewer kind*, and adding per-kind renderer components for **PDF**
(`react-pdf` over pdf.js), **DOCX** (`docx-preview`), and **XLSX** (`xlsx`/SheetJS → HTML grid),
alongside the unchanged image (`<img>`) and text (Monaco) paths plus a graceful **unsupported**
fallback. All document bytes are served from the **same `cosmos-file://` confinement envelope**,
which is relaxed from image-only to "stream any in-root regular file" while keeping its
confine/never-throw/no-token guarantees. The work is **renderer + one main-protocol relaxation + one
CSP edit**; it adds NO new `fs:*` IPC channel, NO agent/MCP/A2UI surface, and NO editing. The
routing decision is pure and node-tested; the renderer wiring (worker, CSS, CSP) is called out as
explicit stories because each one silently fails if missed.

## Technical Context

| Item              | Value |
|-------------------|-------|
| Language          | TypeScript (renderer React + one main-process file + one HTML CSP edit) |
| Key dependencies (new) | `react-pdf@^10.4.1` (MIT; pulls `pdfjs-dist@5.4.296`), `docx-preview@^0.3.7` (Apache-2.0; pulls `jszip`), `xlsx@0.18.5` (SheetJS, Apache-2.0) |
| Rejected         | `@cyntler/react-doc-viewer` (remote fallback for docx/xlsx — violates local-only); `mammoth` (lower docx fidelity than docx-preview); raw `pdfjs-dist@6` direct (more hand-wiring; only if 6.x engine specifically wanted) |
| Files to create   | `src/renderer/fileExplorer/viewerRegistry.ts` (pure) + `.test.ts`; `src/renderer/fileExplorer/PdfView.tsx`; `src/renderer/fileExplorer/DocxView.tsx`; `src/renderer/fileExplorer/SheetView.tsx`; `src/renderer/fileExplorer/fetchLocalFileBytes.ts` (pure-ish ArrayBuffer fetch helper); possibly `src/renderer/fileExplorer/pdfWorker.ts` (worker wiring) |
| Files to modify   | `src/main/localFileProtocol.ts` + `src/main/fileKind.ts` (relax image-only gate / add viewer-kind classification); `src/renderer/fileExplorer/viewerState.ts` (extend `ViewerState` union); `src/renderer/fileExplorer/FileViewer.tsx` (`ViewerBody` routes new kinds); `src/renderer/fileExplorer/useFileExplorer.ts` (resolve doc kinds, not just text/image); `src/shared/ipc/fs.ts` (extend `FsReadResult` marker kinds if doc kinds ride the read result); `src/renderer/index.html` (CSP `connect-src`); `package.json` |
| New IPC channel?  | **No** — reuse `fs:read` (kind markers) + the relaxed `cosmos-file://` stream. No preload change ⇒ **no `npm run dev` restart** required for IPC (but a restart IS needed once for the new renderer deps to bundle). |
| Design step       | **Yes** — UI-bearing. A `design` step (designer, `.sdd/designs/file-viewer-multiformat-v1.md`) owns the viewer chrome for PDF page scroller, sheet selector, the loading/unsupported/error/too-large state blocks, and how each renderer is themed to cosmos-dark tokens. Build wiring (npm installs) stays with the developer/main session. |

---

## Design decisions (the "how")

### Viewer registry + routing (FR-005, FR-011)

- New pure module `viewerRegistry.ts` (no DOM/Electron import): a single function
  `resolveViewerKind(name, sniff)` → a `ViewerKind` union
  (`'text' | 'image' | 'pdf' | 'docx' | 'sheet' | 'unsupported'`). Extension-keyed
  (`pdf`→`pdf`, `docx`→`docx`, `xlsx`/`xls`→`sheet`, image exts→`image`, …), with the existing
  text-vs-binary **sniff** as the fallback for extension-less/ambiguous files (text sniff →
  `text`, else → `unsupported`). This generalizes today's `classifyFile`/`fileKind.ts` (image vs
  text vs binary) into the registry; the existing image-extension set is reused.
- **Where it runs.** Two coherent options; pick **Option A** unless byte-sniff in main is
  preferred:
  - **Option A (recommended) — classify in MAIN, marker over `fs:read`.** Extend `fileKind.ts`'s
    `classifyFile`/`FileKind` to return the doc kinds and extend `FsReadResult` with
    `{ok:true,kind:'pdf'|'docx'|'sheet'}` **markers** (mirroring the existing `kind:'image'`
    marker — bytes do NOT ride IPC; the renderer then fetches `cosmos-file://`). The renderer maps
    the marker straight to the viewer. This keeps ONE classification site and reuses the marker
    precedent exactly.
  - **Option B — classify in RENDERER.** `fs:read` keeps returning `binary` for non-text/non-image;
    the renderer intercepts BEFORE showing the binary block, runs `resolveViewerKind`, and for a
    doc kind fetches the bytes itself. Pure registry lives only in renderer; no `fs.ts`/`fsExplorer`
    change. Simpler IPC, but the binary-vs-doc decision splits between main (text sniff) and
    renderer (extension). **Option A is cleaner** — extend the existing marker contract.

### Bytes → each renderer (FR-007)

- **PDF (`react-pdf`)** takes a **URL/`file` prop** → pass `buildLocalFileSrc(paneId, relPath)`
  directly; pdf.js fetches the bytes itself over `cosmos-file://`. (CSP `connect-src` must allow it.)
- **DOCX (`docx-preview`)** + **XLSX (`SheetJS`)** take an **`ArrayBuffer`** → a shared
  `fetchLocalFileBytes(paneId, relPath)` helper does `fetch(buildLocalFileSrc(...))` →
  `res.arrayBuffer()`, handed to `renderAsync(buf, container)` (docx) / `XLSX.read(buf,{type:'array'})`
  + `sheet_to_html(ws)` (sheet). One fetch helper, two consumers.
- **No new arbitrary-fs IPC** — every byte still flows through the confined `cosmos-file://` handler.

### `cosmos-file://` relaxation (FR-007, FR-014, edge case)

- `localFileProtocol.ts` `handleLocalFile` currently `return brokenImageResponse(415)` for any
  non-image. Relax to **stream any confined in-root regular file** (keep the `statSync().isFile()`
  guard, the `pathConfine` gate, the never-throw discipline, the no-size-cap stream). Optionally set
  a `Content-Type` from the extension (helps pdf.js/`<embed>` but not required since libs parse
  bytes). The confinement + paneId-root resolution + SSRF gate are **unchanged** — the only change
  is dropping the image-extension allowlist. (Sibling-authority alternative considered and rejected:
  one relaxed handler is simpler and the security envelope is identical.)
- Keep `isImageExtension` for the renderer's image-vs-document routing (it stays the image set);
  only the protocol handler's gate is relaxed.

### Worker + bundling (FR-013) — the classic pdf.js gotcha

- pdf.js needs its worker. With `react-pdf` + Vite: set, once, in the module that uses
  `<Document>`/`<Page>`:
  ```ts
  import { pdfjs } from 'react-pdf'
  pdfjs.GlobalWorkerOptions.workerSrc =
    new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  ```
  This `new URL(..., import.meta.url)` is Vite-native — it emits a hashed same-origin asset for BOTH
  dev and packaged builds, so (like Monaco's `?worker`) **NO `electron.vite.config.ts` rollup
  `input` is needed** (rollup `input` is only for main-process MCP entry scripts — DEVELOPMENT.md).
  It needs `vite/client` ambient types, already present via `src/renderer/vite-env.d.ts`.
- Import the two react-pdf CSS files (`react-pdf/dist/Page/AnnotationLayer.css`,
  `…/TextLayer.css`) or text selection/annotations render unstyled.
- **CSP (load-bearing).** Add `connect-src 'self' cosmos-file:` to `src/renderer/index.html`'s CSP
  (so pdf.js/docx/sheet `fetch` of `cosmos-file://` isn't blocked by the `default-src 'self'`
  fallback). The worker is a same-origin bundled asset → covered by the existing
  `worker-src 'self' blob:`. Without the `connect-src` edit, documents silently fail to load.
- A `*.css` import + a new renderer dependency means **one `npm run dev` restart** to pick up the
  new bundle (not an HMR-only change), though no preload method is added.

### States (FR-008)

- Extend `ViewerState` (`viewerState.ts`) with the doc kinds + the new states. Proposed union adds:
  `{kind:'pdf'|'docx'|'sheet', relPath, name}` (rendered branches), plus a generic
  `{kind:'unsupported', …}` (registry had no viewer) and `{kind:'render-error', …}` (a registered
  renderer threw on a corrupt file) and `{kind:'too-large', …}` (over the per-format cap). The
  existing `loading`/`text`/`image`/`binary`/`denied`/`not-found` stay. `binary` becomes the residual
  "sniffed binary, no viewer" → can fold into `unsupported` or stay distinct (designer's call on copy).
- Per-renderer errors are caught in the component (try/catch around `renderAsync`/`XLSX.read`; an
  `onError`/error-boundary for react-pdf) → set the calm `render-error` block; never bubble to crash
  the column or a sibling tab (reuse the per-tab isolation already in `openFiles.ts`).

### Size cap (FR-012) — OQ-2

- A per-format byte cap (proposal PDF 50MB / DOCX 25MB / XLSX 15MB) checked from the file's size.
  Two ways to learn size without reading the whole file: (a) main returns a `too-large` marker from
  `fs:read` after `statSync` (cleanest — main already stats), or (b) the renderer reads
  `Content-Length` from the `cosmos-file://` fetch HEAD/response. **Prefer (a)** — main stats anyway.
  If OQ-2 resolves to "no cap in v1", drop this story (matches the existing no-cap stance).

---

## Implementation Checklist

> Sequential where there's a dependency; the three renderer components (PDF/DOCX/SHEET) are
> independent of each other once the registry + protocol relaxation land.

### Phase 0 — Spec sign-off + design
- [ ] Confirm spec open questions (PDF lib = react-pdf vs raw pdfjs-dist; size caps; CSV/MD depth)
- [ ] `design` step: designer produces `.sdd/designs/file-viewer-multiformat-v1.md` (viewer chrome:
      PDF page scroller, sheet selector, loading/unsupported/error/too-large state blocks, cosmos-dark
      theming per renderer) — no new shadcn primitive / token unless justified

### Phase 1 — Registry + types (pure, node-tested first)
- [ ] Read spec, confirm no open questions remain
- [ ] Create `viewerRegistry.ts` — `resolveViewerKind(name, sniff)` → `ViewerKind` union (pure, reuses image set, generalizes `fileKind.ts`)
- [ ] Write `viewerRegistry.test.ts` — pdf/docx/xlsx/xls/image/text/extension-less-binary/unknown cases (happy + fallback)
- [ ] Extend `ViewerState` (`viewerState.ts`) with `pdf`/`docx`/`sheet`/`unsupported`/`render-error`/`too-large`; update `selectFile`/`resolveRead` and their tests
- [ ] (Option A) Extend `FileKind` + `classifyFile` (`fileKind.ts`) + `FsReadResult` (`src/shared/ipc/fs.ts`) with doc markers; update `fs.validate.ts` if needed; node-test `classifyFile`

### Phase 2 — `cosmos-file://` relaxation + CSP + bundling
- [ ] `localFileProtocol.ts`: relax the image-only 415 gate to stream any confined in-root regular file (keep confine + isFile + never-throw + no-cap); optional extension→Content-Type
- [ ] `src/renderer/index.html`: add `connect-src 'self' cosmos-file:` to the CSP
- [ ] `npm install react-pdf docx-preview xlsx` (developer/main session — designer has no Bash); restart `npm run dev`
- [ ] Add `fetchLocalFileBytes(paneId, relPath)` helper (`fetch(buildLocalFileSrc) → arrayBuffer`)
- [ ] Wire pdf.js worker (`new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)`) + import react-pdf CSS; verify worker loads in dev AND `npm run build`

### Phase 3 — Renderer components (independent; each isolates its own errors)
- [ ] `PdfView.tsx` — `<Document file={buildLocalFileSrc(...)}>` + paged/continuous `<Page>`; loading + onError→`render-error`; themed
- [ ] `DocxView.tsx` — `fetchLocalFileBytes` → `docx-preview.renderAsync(buf, container)`; try/catch→`render-error`; themed container
- [ ] `SheetView.tsx` — `fetchLocalFileBytes` → `XLSX.read(buf,{type:'array'})`; sheet selector; `sheet_to_html(ws)` read-only table (sanitize/scope the injected HTML); try/catch→`render-error`; themed
- [ ] `FileViewer.tsx` `ViewerBody`: route `pdf`/`docx`/`sheet`/`unsupported`/`render-error`/`too-large` to the new components/blocks; keep `text`/`image`/`denied`/`not-found`/`loading` unchanged
- [ ] `useFileExplorer.ts`: resolve doc kinds (Option A: from the new marker; Option B: registry interception) into the per-tab `ViewerState`; preserve watch re-read + per-tab isolation

### Phase 4 — States, size cap, fallback
- [ ] Size cap (if OQ-2 keeps it): main `too-large` marker via `statSync`; viewer shows calm "too large" block with file name
- [ ] Verify unsupported/binary → calm "No preview available"; corrupt file of a known type → calm "Couldn't open this file"; neither crashes nor affects sibling tabs
- [ ] Verify offline render of pdf/docx/xlsx/image/code (SC-002)

### Phase 5 — Tests + docs
- [ ] `npm run typecheck` (node + web) + `npm test` green; registry + viewerState tests cover routing
- [ ] Update `docs/ARCHITECTURE.md` §4.13 (viewer registry + relaxed `cosmos-file://` + the document renderers) and `docs/DEVELOPMENT.md` (pdf.js worker via `new URL(import.meta.url)`, the CSP `connect-src` gotcha, the SheetJS-on-npm-0.18.5 note) — architect owns ARCHITECTURE, developer owns DEVELOPMENT
- [ ] `memory_save` the package decisions + the CSP `connect-src` gotcha + the `cosmos-file://` relaxation
- [ ] Reconcile `TODO.md` (wrap-up)

---

## Risks / Notes

- **Silent failure points (each its own checklist item):** (1) pdf.js worker not wired → blank PDF;
  (2) CSP missing `connect-src cosmos-file:` → docx/sheet/pdf fetch blocked, blank/error; (3) the
  `cosmos-file://` 415 gate left image-only → every document is a broken stream. All three fail
  quietly, so each is verified explicitly (SC-005).
- **pdf.js major pinning.** `react-pdf@10.4.1` brings `pdfjs-dist@5.4.296`. Do NOT also add a
  standalone `pdfjs-dist@6` — keep one major. If the team wants the 6.x engine, switch the PDF story
  to raw `pdfjs-dist@6.0.227` + a hand-rolled canvas page loop (more code; reflect in OQ-1).
- **SheetJS source.** Use the npm-registry `xlsx@0.18.5` (Apache-2.0). Newer SheetJS lives on the
  SheetJS CDN; 0.18.5 is the last npm build and is sufficient for read-only parse → HTML. Document
  this so a future "why not latest xlsx" question is answered.
- **`sheet_to_html` injects an HTML string** — scope/contain it (and consider DOMPurify, already a
  dep used by the Confluence path) so a hostile workbook can't inject script; the renderer
  `script-src 'self'` already blocks inline script execution, but sanitize defensively.
- **docx-preview pulls `jszip`** (already transitively common); confirm no version clash.
- **Single classification site.** Prefer Option A (extend the marker contract) so the "is this a
  doc?" decision is not split across main and renderer.

## Open-question resolutions (developer, SDD steps 3–5)

- **OQ-1 PDF library → `react-pdf@^10.4.1` (MIT).** Lightest React-idiomatic path; React 19 +
  Vite 7 peers satisfied; pulls `pdfjs-dist@5.4.296` (the 5.x line — NOT mixed with a standalone
  6.x). Worker wired via the Vite-native `new URL('pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url)` in `PdfView.tsx`; both react-pdf CSS layers imported. No rollup `input`.
- **OQ-2 Size caps → SHIP caps.** Per-format byte ceilings enforced in MAIN via `statSync`
  (no whole-file read to refuse): PDF 50 MB, DOCX 25 MB, XLSX/sheet 15 MB (pure `viewerCaps.ts`).
  Over the cap → `{ok:false, reason:'too-large'}` marker → calm "File too large to preview" block.
  Text/image keep their deliberate NO-cap stance.
- **OQ-3 CSV/Markdown depth → DEFER (per FR-015).** `.md` / `.csv` route to `text` (Monaco) via
  the registry sniff. No rich Markdown preview, no CSV grid in v1.

## Deviations & Notes

- **Option A taken** (classify in MAIN, markers over `fs:read`): `resolveViewerKind` (new pure
  `src/main/viewerKind.ts`) routes; `fsExplorer.read` returns `{ok:true,kind:'pdf'|'docx'|'sheet'}`
  markers WITHOUT reading the bytes (the renderer fetches them from `cosmos-file://`, FR-007).
  Added `statSize` to the `ExplorerFs` injection surface for the cap.
- **`binary` reason now maps to the `unsupported` ViewerState** (calm "No preview available",
  FR-006). `render-error` is set by the per-format COMPONENT's try/catch (new `renderError()` in
  `viewerState.ts` + `markRenderError` on the hook), never by `resolveRead`.
- **`FsFailureReason` gained `too-large`**; `FsListResult` explicitly excludes both `binary` and
  `too-large` (they classify a file, never a directory list) so `RootError` stays narrow.
- **SheetJS is LENIENT** — `XLSX.read` does NOT throw on garbage (returns a best-effort empty
  workbook), so the SHEET render-error path is driven by the `fetchLocalFileBytes` rejection, not
  a parse throw. `sheet_to_html` output is DOMPurify-sanitized (`sheetHtml.ts`); the `data-v` raw
  cell-value attribute is dropped from the allow-list (it mirrors the un-escaped cell value).
- **CSP**: added `connect-src 'self' cosmos-file:` so docx/sheet `fetch` (and pdf.js internal
  fetch) of the stream isn't blocked by `default-src 'self'`.
- **`cosmos-file://` relaxed**: dropped the image-only 415 gate in `localFileProtocol.ts` — it now
  streams any confined in-root regular file (confine / isFile / never-throw / no-cap unchanged).
- **Preload NOT touched** — reuses existing `fs:read` + `cosmos-file://`; no `window.cosmos.*`
  method added, so no preload-restart needed for IPC (a restart IS needed once for the new
  renderer deps to bundle).
- **No design step ran** (`.sdd/designs/file-viewer-multiformat-v1.md` absent). The new viewer
  chrome (PDF scroller, sheet selector, the unsupported/render-error/too-large state blocks)
  reuses the existing `StateBlock` + cosmos-dark tokens; a designer pass may still refine copy/theming.
- Docs (`ARCHITECTURE.md §4.13`, `DEVELOPMENT.md`, `memory_save`, `TODO.md`) — Phase 5 items NOT
  yet done (architect owns ARCHITECTURE; left for wrap-up).
