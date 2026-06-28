/**
 * monacoSetup — wires Monaco's Web Worker for the renderer build (terminal-file-explorer-v1,
 * design §10.1). Monaco offloads its editor model services to a worker; without `MonacoEnvironment`
 * pointing at a real worker URL the editor silently fails (blank viewer / worker 404). Vite
 * (electron-vite renderer) bundles a `?worker` import as a real worker chunk for BOTH the dev
 * server and the packaged build, so importing the worker with `?worker` is the build-safe wiring
 * (the "worker URLs resolve under dev AND packaged" handoff item).
 *
 * For a READ-ONLY viewer (FR-009) only the base `editorWorkerService` is needed — Monaco's
 * monarch tokenizers (syntax highlighting) run on the MAIN thread, and the per-language
 * diagnostics/IntelliSense workers (ts/json/css/html) are NOT required for read-only display.
 * Returning the base worker for every label keeps the bundle small (one worker, not five) while
 * the editor still renders + highlights. `setupMonaco()` is idempotent (guarded) and called once
 * by the viewer before it creates an editor; the theme is registered here too.
 *
 * ponytail: base editor worker only — no ts/json/css/html language workers. Add them only if a
 * read-only feature ever needs diagnostics/hover (it doesn't today).
 */

import * as monaco from 'monaco-editor'
// Vite emits this as a real worker chunk resolvable in dev + packaged builds.
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import { buildCosmosMonacoTheme, COSMOS_MONACO_THEME } from './monacoTheme'

// ponytail: the `monaco-editor` barrel pulls every basic-language monarch tokenizer AND the
// ts/json/css/html language MODES (each a heavy worker + language service we never use in a
// READ-ONLY viewer), so the packaged renderer bundle is ~9MB + ~15MB of unused language
// workers. Acceptable for a desktop app (loads from disk, not the network) and the barrel is
// the only Monaco entry that resolves cleanly under tsc's Bundler moduleResolution — the slim
// `editor.api` subpath has no `exports`-mapped types and fights the toolchain. Trim later (slim
// `editor.api` + per-language `_.contribution` + custom worker-resolution) ONLY if bundle size
// becomes a real problem; for read-only highlighting the barrel is correct and works today.

let initialized = false

/**
 * Initialize Monaco ONCE: register the worker factory + define the `cosmos-dark` theme from the
 * live CSS tokens. Safe to call repeatedly (the second+ call is a no-op). Returns the `monaco`
 * namespace so the caller creates the editor without re-importing.
 */
export function setupMonaco(): typeof monaco {
  if (initialized) {
    return monaco
  }
  initialized = true
  // Monaco rejects in-flight async work (tokenization / worker requests) with a `CancellationError`
  // — `{ name: 'Canceled', message: 'Canceled' }` — whenever an editor or model is disposed mid-op
  // (fast file-switching, or the FileViewer unmounting). It is benign by design, but surfaces as an
  // "Uncaught (in promise) Canceled: Canceled" in the renderer console. Swallow ONLY that exact
  // shape (everything else propagates untouched) so the console stays clean. Registered once.
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as { name?: unknown; message?: unknown } | null
    if (reason && (reason.name === 'Canceled' || reason.message === 'Canceled')) {
      event.preventDefault()
    }
  })
  // The base editor worker covers read-only display for every language (no per-language worker).
  self.MonacoEnvironment = {
    getWorker: () => new EditorWorker()
  }
  const read = (name: string): string =>
    getComputedStyle(document.documentElement).getPropertyValue(name)
  monaco.editor.defineTheme(COSMOS_MONACO_THEME, buildCosmosMonacoTheme(read))
  return monaco
}
