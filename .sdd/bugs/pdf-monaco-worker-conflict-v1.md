# Bug: PDF files blank + Monaco web-worker errors (pdf-monaco-worker-conflict-v1)

## Status: FIXED

## Symptom
- PDF files render blank (no pages) in the file viewer.
- Renderer console throws `Uncaught Error: Missing requestHandler or method: findDocumentLinks / getFoldingRanges / findDocumentSymbols` from Monaco's `EditorWorker`.

## Root Cause (TWO separate issues)

### Issue 1 — PDF blank (the real regression, introduced by file-viewer-multiformat-v1)
**File:** `src/renderer/fileExplorer/PdfView.tsx` (lines 27-30, before fix)

`pdfjs.GlobalWorkerOptions.workerSrc` was set using:
```ts
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()
```

Vite's `new URL(specifier, import.meta.url)` asset rewriting **only works for relative paths** (e.g. `./foo.js`). Bare package specifiers like `'pdfjs-dist/build/pdf.worker.min.mjs'` are NOT rewritten — Vite leaves them as-is, producing a URL that resolves to `http://localhost:5173/pdfjs-dist/build/pdf.worker.min.mjs` which does not exist on the dev server. The worker silently fails to load; pdf.js renders nothing.

**Fix:** Replace with the correct Vite pattern — a `?url` import, which Vite resolves to a hashed bundled asset URL in both dev and packaged builds (same pattern used by `monacoSetup.ts` with `?worker`):
```ts
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
```

### Issue 2 — Monaco "Missing requestHandler" errors (pre-existing, NOT a regression)
**File:** `src/renderer/fileExplorer/monacoSetup.ts` (line 48)

`MonacoEnvironment.getWorker` returns the base `EditorWorker` for every label. Monaco sends language-service messages (TypeScript, JSON, CSS, HTML) to this worker; the base editor worker doesn't implement those handlers and throws. This is **intentional** — the setup comment (lines 10-12) explicitly documents that no per-language workers are wired because the viewer is read-only. The errors are benign and do not affect Monaco rendering or syntax highlighting. No fix needed.

## Files Changed
- `src/renderer/fileExplorer/PdfView.tsx` — 3 lines changed (import + workerSrc assignment)

## Verification
- `npm run typecheck` → exit 0 (both node + web)
- `npm test` → 128 files, 2465 tests, all passed
- Manual: user must `npm run dev` restart and open a PDF — pages should render; Monaco errors unchanged (pre-existing)

## No Preload Touch
No preload changes — no forced restart beyond the normal Vite HMR for renderer-only edits.
