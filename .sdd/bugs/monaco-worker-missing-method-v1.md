# Bug: Monaco editor-worker "Missing requestHandler or method" console spam

ID: `monaco-worker-missing-method-v1`
Skill: bugfix
Status: Fixed (pending `npm run dev` eyeball)
Reported: 2026-07-01

## Symptom (user)

The renderer console spams in `npm run dev` whenever the file viewer opens a file:

```
Uncaught Error: Missing requestHandler or method: findDocumentLinks
Uncaught Error: Missing requestHandler or method: findDocumentSymbols
Uncaught Error: Missing requestHandler or method: getFoldingRanges
```

thrown from `monaco-editor/esm/vs/editor/common/services/editorWebWorker.js`, `EditorWorker.$fmr`.
monaco-editor is `^0.55.1`.

## Investigation

Two hypotheses were on the table: (a) a stale Vite dep-cache / main-vs-worker version skew, or
(b) a structural mismatch where the base worker is asked for methods it lacks.

- **(a) RULED OUT.** The user cleared `node_modules/.vite` and re-ran; the `.vite/deps` version hash
  changed (`?v=9571762b` → `?v=5b1bc1e6`, proving Vite re-optimized) and the three errors STILL
  throw. Not a cache/skew problem.
- **(b) CONFIRMED — structural.** `findDocumentLinks` / `findDocumentSymbols` / `getFoldingRanges`
  are methods of the **language-service workers** (json/css/html), implemented in
  `monaco-editor/esm/vs/language/common/lspLanguageFeatures.js` (used by `cssWorker`/`htmlWorker`/
  `jsonWorker`). The **base** `editor.worker` (`editorWebWorker.js`) does NOT implement them
  (`grep` of the base worker → 0 hits for the three names).

  The app imports the FULL `monaco-editor` barrel, which registers the json/css/html language
  MODES. On first use of a matching model those modes call
  `languages.registerFoldingRangeProvider` / `registerLinkProvider` / `registerDocumentSymbolProvider`
  with adapters that delegate to a language worker via `getWorker(_, label)`. But
  `monacoSetup.ts` sets `MonacoEnvironment.getWorker = () => new EditorWorker()` — the **base**
  worker for **every** label (read-only viewer: one small worker by design, no ts/json/css/html
  language workers). So the language providers query the base worker for methods it lacks → the
  `$fmr` "Missing requestHandler or method" error.

  These providers fire only because DEFAULT-ON editor features consume them on model attach:
  - `getFoldingRanges` ← the **folding** controller (`folding` editor option, default `true`) —
    `FoldingController.onModelChanged` returns early only when `!this._isEnabled`.
  - `findDocumentLinks` ← the **link** detector (`links` editor option, default `true`) —
    `LinkDetector.beginCompute` returns early only when `!getOption(links)`.
  - `findDocumentSymbols` ← the **sticky-scroll** outline (`stickyScroll` editor option, default
    `{ enabled: true, defaultModel: 'outlineModel' }`) — sticky scroll's
    `StickyModelFromCandidateOutlineProvider` calls `OutlineModel.create(documentSymbolProvider)`.
    `StickyLineCandidateProvider.readConfiguration` returns early (before creating the model
    provider, before adding any model listener) when `!options.enabled`. The only OTHER automatic
    document-symbol consumers are diff-editor breadcrumbs (diff editor only) and goto-symbol
    quick-access (user command Cmd+Shift+O) — neither fires automatically in a standalone read-only
    editor.

  **Not a regression from the shared-model change** (`cosmos-terminal-favorite-explorer-share-v1`,
  ee52524): the previous `monaco.editor.create({ value, ...buildViewerEditorOptions })` path set the
  SAME language (`buildViewerEditorOptions().language`) and left the SAME default-on features, so it
  triggered the identical provider calls. The trigger is structural (base-only worker + full barrel),
  present for any json/css/html/scss/less file regardless of the model URI.

## Fix

Turn off the three worker-backed features **at the source** (so the providers never query the
worker), in the PURE `buildViewerEditorOptions` (`src/renderer/fileExplorer/monacoTheme.ts`):

```
folding: false
links: false
stickyScroll: { enabled: false }
```

Why disable the CONSUMERS rather than the providers: Monaco queries and MERGES results from ALL
registered document-symbol providers, so registering an extra no-op document-symbol provider would
NOT stop the worker-backed json/css/html provider from firing. Disabling the consumer feature
(sticky scroll) is what actually prevents `OutlineModel.create` from being called. Disabling the
whole features is appropriate for a READ-ONLY viewer, which needs neither code folding, link
detection, nor a sticky-scroll outline. Preferred over shipping the heavier language workers (keeps
the "base worker only, small bundle" intent in `monacoSetup.ts`).

**Preserved:**
- **Syntax highlighting** — monarch tokenizers run on the MAIN thread (`onDidChangeModelTokens`),
  independent of these three providers; the language id is still resolved
  (`buildViewerEditorOptions().language`).
- **Explorer-share shared-model content-sync** — no change to the model registry / `setModel` /
  `syncText` path.

## Regression test

`src/renderer/fileExplorer/monacoTheme.test.ts` (node-unit, no Monaco — Monaco crashes jsdom, so the
pure options object is the seam): asserts `buildViewerEditorOptions('config.json')` returns
`folding:false`, `links:false`, `stickyScroll.enabled:false`, AND that css/html still resolve their
language id (highlighting intact). Registry as `FV-MONACO-WORKER-01` in `docs/TEST-SCENARIOS.md`.

## Verification

- `npm run typecheck` green.
- `npm test` green (146 files, 2779 tests) — includes the new assertions and the existing
  Monaco-mocked / explorer-share content-sync tests.
- `npm run test:dom` green (33 files, 172 tests) — `MonacoTextModelRegistry.dom.test.tsx` +
  `useFileExplorerShare.dom.test.tsx` (shared-model content-sync) stay green.
- `npm run build` green.
- MANUAL (`npm run dev`, not exercisable in the harness — Monaco renders only in the real app):
  open a `.json` / `.css` / `.html` file → console clean of the three worker errors; the viewer
  still renders with syntax highlighting and the terminal-favorite content-sync still works.
