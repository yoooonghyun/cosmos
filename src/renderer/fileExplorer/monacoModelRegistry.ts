/**
 * monacoModelRegistry — a renderer-only, ref-counted registry of shared Monaco `ITextModel`s keyed
 * by file identity (`cosmos-file://<paneId>/<relPath>`), so MORE THAN ONE editor VIEW (a source
 * Terminal viewer + a Home terminal-favorite viewer) can attach to the SAME buffer
 * (cosmos-terminal-favorite-explorer-share-v1, FR-003/FR-007). "Share the data instance, render two
 * views" — exactly how Monaco itself separates the model (text + language + undo) from the editor
 * view (cursor + scroll + selection). Content + language stay identical and live across both views;
 * cursor/scroll stay per-view (they live on the editor, not the model).
 *
 * READ-ONLY (OQ-1/FR-013): v1 shares the model purely so two read-only views show one buffer. The
 * editor stays `readOnly`/`domReadOnly`; nothing here writes to disk. This registry is the seam a
 * FUTURE editability feature would build on — it is NOT that feature.
 *
 * Ref-counting (FR-007, the dispose-danger): a model is created lazily on first `acquire` of a file
 * and disposed ONLY when the file is `release`d (closed in the shared open-files store) AND no editor
 * view remains attached (`attachCount === 0`). A favorite tab-switch `detach`es its editor WITHOUT
 * disposing a model the source still renders.
 *
 * The Monaco model factory is INJECTABLE so the refcount/dispose logic is node-unit-testable WITHOUT
 * importing Monaco (which crashes jsdom). The key computation ({@link cosmosFileUri}) is Monaco-free
 * too, so a non-Monaco caller (the owning `useFileExplorer`, which only `release`s on close) can use
 * the shared registry without dragging Monaco into its import graph — only the factory's
 * `getModel`/`createModel` (called by `MonacoText`) touch Monaco.
 */

/** The minimal model surface the registry manipulates (a subset of Monaco's `editor.ITextModel`). */
export interface ModelLike {
  getValue(): string
  setValue(value: string): void
  dispose(): void
}

/**
 * The injectable Monaco bridge: map a canonical `cosmos-file://` key string ↔ a real `ITextModel`.
 * The registry owns the KEY (Monaco-free, {@link cosmosFileUri}); the factory only turns that key
 * into / looks it up as a Monaco model. Production wires this from `setupMonaco()` in `FileViewer`;
 * node tests pass a fake so no Monaco is imported.
 */
export interface ModelFactory {
  /** Return the already-existing model for this key, or `null`. */
  getModel(uri: string): ModelLike | null
  /** Create a new model for this key with the given text + Monaco language id. */
  createModel(text: string, language: string, uri: string): ModelLike
}

/** The registry surface used by `MonacoText` (acquire/sync/detach) + the owning hook (release). */
export interface MonacoModelRegistry {
  /** The canonical `cosmos-file://<paneId>/<relPath>` key for a file (Monaco-free). */
  modelUri(paneId: string, relPath: string): string
  /** Attach a view to a file's shared model — create it lazily, bump the refcount, clear `released`. */
  acquire(paneId: string, relPath: string, text: string, language: string): ModelLike
  /** Push fresh text into a shared model (a watch re-read) — only `setValue` when it differs. */
  syncText(model: ModelLike, text: string): void
  /** Detach one view (decrement); dispose iff the file was already `release`d and no view remains. */
  detach(paneId: string, relPath: string): void
  /** Mark the file closed in the shared store; dispose iff no view remains attached. */
  release(paneId: string, relPath: string): void
}

/**
 * The canonical model key for a file (Monaco-free so non-Monaco callers can compute it). A different
 * `relPath` (rename/move) yields a DIFFERENT key — rename = close + open, no model migration (OQ-2).
 */
export function cosmosFileUri(paneId: string, relPath: string): string {
  return `cosmos-file://${paneId}/${relPath}`
}

/**
 * Build a registry over an injected {@link ModelFactory}. The refcount/dispose state is closed over
 * (one registry instance = one shared model namespace). Pure of Monaco — the factory is the only
 * Monaco seam.
 */
export function createMonacoModelRegistry(factory: ModelFactory): MonacoModelRegistry {
  const models = new Map<string, ModelLike>()
  const attachCount = new Map<string, number>()
  const released = new Set<string>()

  function maybeDispose(uri: string): void {
    // FR-007: dispose ONLY when the file is closed in the store (released) AND no editor view is
    // attached. A favorite tab-switch (detach with the file still open, or release while the source
    // view is still attached) leaves the model alive.
    if (!released.has(uri)) {
      return
    }
    if ((attachCount.get(uri) ?? 0) > 0) {
      return
    }
    models.get(uri)?.dispose()
    models.delete(uri)
    attachCount.delete(uri)
    released.delete(uri)
  }

  return {
    modelUri: cosmosFileUri,
    acquire(paneId, relPath, text, language) {
      const uri = cosmosFileUri(paneId, relPath)
      let model = models.get(uri)
      if (!model) {
        // Reuse a model Monaco may already hold for this key (defensive), else create one.
        model = factory.getModel(uri) ?? factory.createModel(text, language, uri)
        models.set(uri, model)
      }
      attachCount.set(uri, (attachCount.get(uri) ?? 0) + 1)
      // A re-open of a just-released file resurrects it (re-acquire clears the released latch).
      released.delete(uri)
      return model
    },
    syncText(model, text) {
      // Read-only content-sync: a watch re-read pushed new text into the shared store; keep the one
      // model in step. No-op when unchanged so an unrelated text-effect run never resets the buffer.
      if (model.getValue() !== text) {
        model.setValue(text)
      }
    },
    detach(paneId, relPath) {
      const uri = cosmosFileUri(paneId, relPath)
      const next = (attachCount.get(uri) ?? 0) - 1
      if (next <= 0) {
        attachCount.delete(uri)
      } else {
        attachCount.set(uri, next)
      }
      maybeDispose(uri)
    },
    release(paneId, relPath) {
      const uri = cosmosFileUri(paneId, relPath)
      // Only latch `released` for a model we actually track — releasing a file that never had a text
      // model (image/pdf/never-opened) is a harmless no-op.
      released.add(uri)
      maybeDispose(uri)
    }
  }
}

/**
 * The PROCESS-WIDE shared registry both the source viewer and the favorite viewer attach to. Its
 * Monaco factory is installed lazily by the Monaco-owning module (`FileViewer`) via
 * {@link installMonacoModelFactory}; importing THIS module never imports Monaco, so the owning
 * `useFileExplorer` (which only `release`s on close — a Monaco-free op) can share it freely.
 */
let installedFactory: ModelFactory | null = null

/** Install the real (Monaco-backed) factory once. Idempotent — the first install wins. */
export function installMonacoModelFactory(factory: ModelFactory): void {
  if (!installedFactory) {
    installedFactory = factory
  }
}

function requireFactory(): ModelFactory {
  if (!installedFactory) {
    throw new Error('[monacoModelRegistry] Monaco model factory not installed (call installMonacoModelFactory)')
  }
  return installedFactory
}

const lazyFactory: ModelFactory = {
  getModel: (uri) => requireFactory().getModel(uri),
  createModel: (text, language, uri) => requireFactory().createModel(text, language, uri)
}

export const sharedMonacoModelRegistry: MonacoModelRegistry = createMonacoModelRegistry(lazyFactory)
