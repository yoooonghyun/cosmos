/**
 * useFileExplorer — the renderer hook that DRIVES the file tree + viewer for one terminal
 * tab (terminal-file-explorer-v1, FR-003/FR-004/FR-008/FR-014/FR-017). It owns:
 *   - the pure tree state (`tree.ts`) rooted at the tab's cwd,
 *   - the lazy `fs:list` on first expand + the root list on go-live,
 *   - the `fs:read` for the open file (text / image / state),
 *   - the watch lifecycle (`watchStart` on go-live, `watchStop` on teardown) and the
 *     SEAMLESS re-list on `fs:changed` (re-list every expanded dir, merge into state — §6),
 *   - the open-file invalidation when the watched file vanishes (FR-017).
 *
 * The hook addresses every node by `paneId` + root-RELATIVE path only — main holds the
 * authoritative root (`terminalSessionMap`) and confines the read. No absolute path, no
 * token, ever crosses into the renderer.
 *
 * `enabled` gates the whole thing on the tab being LIVE (a chosen cwd). While awaiting a
 * directory the hook issues NO `fs:list`/`fs:watch` (FR-006); the placeholder renders.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  expandedDirPaths,
  findNode,
  makeRoot,
  mergeListing,
  setLoading,
  toggleExpand,
  type TreeNode
} from './tree'
import {
  renderError,
  resolveRead,
  type ViewerState
} from './viewerState'
import {
  activeViewer,
  closeFile as closeOpenFile,
  openOrFocus,
  seedOnGoLive,
  setActiveFile as setActiveOpenFile,
  updateOpenFile,
  type OpenFile
} from './openFiles'
import { useSharedOpenFiles } from './OpenFilesProvider'
import { sharedMonacoModelRegistry } from './monacoModelRegistry'

/** The persisted open-files slice handed to the hook to seed from on go-live (FR-004). */
export interface RestoredOpenFiles {
  files: string[]
  activeRelPath: string | null
}

/** Why the root list could not complete (drives the §2.3 tree error block). `null` = ok. */
export type RootError = 'denied' | 'not-found' | 'out-of-root' | null

/**
 * The middle-column viewer state lives in the pure `viewerState.ts` (node-tested). `null` is the
 * "no file selected" placeholder, NOT "the tree is showing" — the tree dock (RIGHT) is ALWAYS
 * visible in the 3-pane layout; opening a file only retargets the MIDDLE column.
 */
export type { ViewerState } from './viewerState'
export type { OpenFile } from './openFiles'

export interface UseFileExplorer {
  /** The tree root node (its children are the top-level rows). */
  tree: TreeNode
  /** Root-list error, or `null`. Drives the §2.3 error/Retry block. */
  rootError: RootError
  /** True while the ROOT's first list is outstanding (skeleton; design §2.3). */
  rootLoading: boolean
  /** The ORDERED open files for the tab strip (terminal-file-tabs-v1, FR-001). Empty → no strip. */
  openFiles: OpenFile[]
  /** The active file's relPath (drives the tree highlight; `null` when no file is open, FR-016). */
  activeRelPath: string | null
  /** The ACTIVE file's viewer state, or `null` for the "Select a file" placeholder (FR-008). */
  viewer: ViewerState
  /** Toggle a directory's expansion; lists it on first expand (lazy). */
  toggleDir: (relPath: string) => void
  /** Open OR focus this file as a tab (open-or-focus, FR-002/FR-017); the tree dock stays visible. */
  openFile: (relPath: string) => void
  /** Make an already-open file the active tab (FR-003). */
  setActiveFile: (relPath: string) => void
  /** Close one file's tab (FR-004/FR-005); the active one re-picks the adjacency neighbour. */
  closeFile: (relPath: string) => void
  /** Flip an open document tab to the calm "Couldn't open this file" block when its renderer
   * threw on a corrupt/malformed file (file-viewer-multiformat-v1, FR-008). Touches only that
   * tab; a closed/absent tab is a no-op. */
  markRenderError: (relPath: string) => void
  /** Re-list the root (the §2.3 Retry button). */
  retryRoot: () => void
}

/** Per-mount options (cosmos-terminal-favorite-explorer-share-v1). */
export interface FileExplorerOptions {
  /**
   * NON-OWNING mirror mode (FR-006): a Home terminal-favorite explorer bound to the SAME `paneId` as
   * a source Terminal pane. A mirror reads + writes the SHARED open-files store (so opens/closes/
   * activations reflect in both views) and renders the shared models, but drives NONE of the pane's
   * fs-ownership: no `fs:watch`, no `fs:read` content resolution (the source's resolver fills the
   * shared store), no go-live seed, no `onOpenFilesChange` report, no model `release`/`clear` on
   * teardown. It DOES list its OWN tree (`fs:list` on go-live + manual expand — idempotent, confined
   * reads, FR-005), refreshing on expand rather than live on `fs:changed` (open-file CONTENT stays
   * live via the owner's watch → shared store → both views). Default `false` = the owning path.
   */
  mirror?: boolean
}

/**
 * Drive the file explorer for one tab. `enabled` is the tab's LIVE phase (a chosen cwd);
 * while false the hook is inert (no list/watch). `paneId` routes every `fs:*` call to the
 * tab's root.
 *
 * persist-workdir-open-files-v1: `restoredOpenFiles` is the persisted open-files slice for
 * this pane (FR-004), seeded ONCE on the first go-live (content re-read from disk — FR-005);
 * `onOpenFilesChange` reports every open-files change to the debounced session save (FR-013).
 *
 * cosmos-terminal-favorite-explorer-share-v1 (FR-002): the open-files SELECTION is no longer
 * per-mount state — it is lifted into the App-root paneId-keyed `OpenFilesProvider` so a SECOND
 * mount of the same pane (a Home terminal favorite) reads + writes the SAME selection. The SOURCE
 * mount (`!mirror`) stays the single owner of `fs:read` resolution + `fs:watch` + the persist/restore
 * seam; the mirror (`options.mirror`) is non-owning (see {@link FileExplorerOptions}).
 */
export function useFileExplorer(
  paneId: string,
  enabled: boolean,
  restoredOpenFiles?: RestoredOpenFiles,
  onOpenFilesChange?: (slice: RestoredOpenFiles) => void,
  options?: FileExplorerOptions
): UseFileExplorer {
  const mirror = options?.mirror ?? false
  const [tree, setTree] = useState<TreeNode>(makeRoot)
  const [rootError, setRootError] = useState<RootError>(null)
  const [rootLoading, setRootLoading] = useState(false)
  // cosmos-terminal-favorite-explorer-share-v1 FR-002: the open-files collection is the LIFTED,
  // paneId-keyed SHARED store (was per-mount `useState`). `entry.openFiles` is this pane's selection;
  // `apply` runs the SAME pure `openFiles.ts` transitions (only the storage moved); `setLive`/`clear`
  // are the owning go-live/teardown signals. Both the source mount and the favorite mount read+write
  // this one store for `paneId`, so they show identical open tabs + active file, live.
  const { entry, apply, setLive, clear } = useSharedOpenFiles(paneId)
  const openFiles = entry.openFiles

  // persist-workdir-open-files-v1 FR-004: the restored slice is seeded on go-live. Held in a ref
  // so the (stable) go-live effect reads it without re-subscribing. It is NEVER cleared from inside
  // the go-live effect (body OR cleanup): a React StrictMode double-mount runs body → cleanup → body
  // synchronously, so clearing in EITHER place makes the SECOND (real) body seed EMPTY and wipes the
  // restored files on relaunch (bug persist-open-files-restore-broken-v1). Instead it is consumed
  // ONLY when the live phase genuinely ENDS (`enabled` goes true→false — a real re-root/disable),
  // tracked by `wasEnabledRef` below, so a later re-enter starts empty (no stale paths) while the
  // dev double-mount re-seeds the SAME slice idempotently. Refs persist across the StrictMode
  // remount, so this survives it. Mirrors the working `restoredScrollbackRef` (never nulled) pattern.
  const restoredOpenFilesRef = useRef<RestoredOpenFiles | undefined>(restoredOpenFiles)
  // Tracks the PREVIOUS `enabled` so a true→false transition (real teardown) consumes the restored
  // slice exactly once — distinct from the StrictMode synchronous remount (which keeps `enabled`).
  const wasEnabledRef = useRef(false)
  // Report every open-files change to the debounced session save (FR-013), via a stable ref so
  // the report callback's identity does not re-fire the go-live effect.
  const onChangeRef = useRef(onOpenFilesChange)
  onChangeRef.current = onOpenFilesChange

  // The latest tree, read inside the (stable) watch handler without re-subscribing on every
  // keystroke change (the handler re-lists the CURRENT expanded dirs, not a stale snapshot).
  const treeRef = useRef(tree)
  treeRef.current = tree
  // The set of currently-open relPaths, read by the watch handler to re-read each on a change and
  // invalidate a vanished one (FR-010) — a tab is keyed by relPath, so this drives every open tab.
  const openRelsRef = useRef<string[]>([])
  openRelsRef.current = openFiles.files.map((f) => f.relPath)
  // cosmos-terminal-favorite-explorer-share-v1 (FR-006): the set of relPaths the resolver effect has
  // a `fs:read` in flight for, so a re-render (or a second loading entry landing) never double-reads
  // the same file. Owning-side only — the mirror drives no reads.
  const inFlightRef = useRef<Set<string>>(new Set())

  // persist-workdir-open-files-v1 FR-013: report the open-files slice on every change so the
  // debounced session save captures the latest set + active path. Reuses the existing save
  // pipeline (no new persistence mechanism). Only meaningful while live; while inert the
  // collection is empty (the report is harmless — it omits an empty slice at the draft).
  // cosmos-terminal-favorite-explorer-share-v1 (FR-006): OWNING-side only — the favorite mirror never
  // reports (the source pane is the single persist owner; the favorite record carries no open files).
  useEffect(() => {
    if (mirror) {
      return
    }
    onChangeRef.current?.({
      files: openFiles.files.map((f) => f.relPath),
      activeRelPath: openFiles.activeRelPath
    })
  }, [mirror, openFiles])

  // cosmos-terminal-favorite-explorer-share-v1 (FR-006, the ONE owning-path change): the single
  // owning RESOLVER. For every open file still `loading` in the shared store — whether the OWNER or
  // the MIRROR dispatched the open, or the go-live seed produced it — fire ONE `fs:read` and land the
  // resolved `ViewerState` back into the SHARED store via `updateOpenFile`. Moving the read OUT of an
  // inline `openFile` into this reconcile effect is what lets a MIRROR-initiated open be resolved by
  // the single fs owner (the mirror writes a `loading` entry; the owner's resolver reads it). READ-
  // ONLY (OQ-1): this only READS content; no `fs:write` exists. The `inFlightRef` dedups so a file is
  // read exactly once per open (a re-click focuses an already-resolved file — never `loading` — so it
  // never re-reads: no jolt). MIRROR drives nothing here.
  useEffect(() => {
    if (mirror) {
      return
    }
    for (const file of openFiles.files) {
      if (file.viewer.kind !== 'loading' || inFlightRef.current.has(file.relPath)) {
        continue
      }
      const rel = file.relPath
      inFlightRef.current.add(rel)
      void window.cosmos.fs.read(paneId, rel).then((res) => {
        inFlightRef.current.delete(rel)
        // Land the read only if the tab is still open (the user may have closed it first).
        if (!openRelsRef.current.includes(rel)) {
          return
        }
        // `resolveRead` maps ok → text/image and every benign failure (not-found/denied/binary) to
        // its calm block — a vanished restored file lands as "no longer available" (FR-008).
        apply((s) => updateOpenFile(s, rel, resolveRead(rel, res)))
      })
    }
  }, [mirror, paneId, openFiles, apply])

  // List a directory and MERGE it into the tree (seamless). `firstList` shows the skeleton
  // for the initial root/expand; a watch re-list passes false so no skeleton flashes (§6).
  const listDir = useCallback(
    async (relPath: string, firstList: boolean): Promise<void> => {
      if (relPath === '' && firstList) {
        setRootLoading(true)
        setRootError(null)
      }
      const res = await window.cosmos.fs.list(paneId, relPath)
      if (relPath === '' && firstList) {
        setRootLoading(false)
      }
      if (res.ok) {
        if (relPath === '') {
          setRootError(null)
        }
        setTree((t) => mergeListing(t, relPath, res.entries))
      } else if (relPath === '') {
        setRootError(res.reason)
      } else {
        // A child list failed — clear its loading flag; the row shows no children. (A denied
        // sibling never aborts the others; coarse here, per-row Notice is a later refinement.)
        // ponytail: child-list errors clear loading only; add per-folder Notice if users hit it.
        setTree((t) => setLoading(t, relPath, false))
      }
    },
    [paneId]
  )

  // Go-live: list the root (BOTH owner + mirror — idempotent `fs:list`, FR-005) and, for the OWNER
  // only, seed the shared open-files store + start the watcher. Teardown / disable: stop the watcher;
  // the genuine `enabled` true→false transition (owner) clears the shared store + releases its models.
  // FR-006/FR-015/FR-016; cosmos-terminal-favorite-explorer-share-v1 FR-002/FR-006.
  useEffect(() => {
    if (!enabled) {
      // The live phase genuinely ended (re-root / disable) — consume the restored slice so a later
      // re-enter starts empty, not with stale paths, AND clear the shared store + release its models
      // (owning teardown). A StrictMode remount keeps `enabled` true, so it never reaches here between
      // the double-invoke (the seed survives — see ref note above). Mirror never owns this.
      if (!mirror && wasEnabledRef.current) {
        restoredOpenFilesRef.current = undefined
        wasEnabledRef.current = false
        for (const rel of openRelsRef.current) {
          sharedMonacoModelRegistry.release(paneId, rel)
        }
        setLive(false)
        clear()
      }
      return
    }
    setTree(makeRoot())
    // BOTH views list their OWN tree (per-view tree expansion, FR-005). The mirror's tree refreshes
    // on manual expand (no `fs:watch`); the owner's also re-lists on `fs:changed` below.
    void listDir('', true)
    if (mirror) {
      // cosmos-terminal-favorite-explorer-share-v1 (FR-006): the mirror is NON-OWNING — no go-live
      // seed, no `fs:watch`, no `fs:read` resolution, no report. Its open files + content come from
      // the SHARED store the OWNER fills; only the tree above is its own. So it returns here.
      return
    }
    wasEnabledRef.current = true
    // persist-workdir-open-files-v1 FR-004 + FR-002: on go-live, SEED the SHARED open-files store from
    // this pane's persisted slice (consumed once — a later re-enter starts empty). Each restored file
    // starts `loading`; the RESOLVER effect above then fires one `fs:read` per path to re-read its
    // content from disk (FR-005 — contents are never persisted), landing it back in the shared store.
    // Read the restored slice WITHOUT clearing it here — it is consumed only on a genuine `enabled`
    // true→false transition (the `!enabled` branch above). A StrictMode double-invoke re-runs this
    // body with the SAME slice and re-seeds idempotently instead of wiping to EMPTY (bug
    // persist-open-files-restore-broken-v1).
    apply(() => seedOnGoLive(restoredOpenFilesRef.current))
    setLive(true)
    window.cosmos.fs.watchStart(paneId)
    const off = window.cosmos.fs.onChanged((payload) => {
      if (payload.paneId !== paneId) {
        return
      }
      // SEAMLESS re-list (§6): re-list every currently-expanded directory (no skeleton) and
      // merge. Then re-read every OPEN file; a vanished one flips THAT tab to "no longer
      // available" (FR-010) without disturbing the others. The re-read lands in the SHARED store, so
      // BOTH views (source + favorite) show the live content change at once (FR-003, Scenario 4).
      const dirs = expandedDirPaths(treeRef.current)
      for (const dir of dirs) {
        void listDir(dir, false)
      }
      for (const openRel of openRelsRef.current) {
        // Re-read each open file and apply the FRESH result to its tab. Coarse but cheap (one read
        // per open file per change). ponytail: re-read all open on every change.
        void window.cosmos.fs.read(paneId, openRel).then((res) => {
          // Skip if the tab was closed before the read landed (no longer open).
          if (!openRelsRef.current.includes(openRel)) {
            return
          }
          // ok → the NEW text/image content (the live on-disk change the user expects to see),
          // not-found → "no longer available" (FR-010), other benign failures → their calm block.
          apply((s) => updateOpenFile(s, openRel, resolveRead(openRel, res)))
        })
      }
    })
    return () => {
      off()
      window.cosmos.fs.watchStop(paneId)
      // NOTE: the restored slice + the shared store are intentionally NOT consumed/cleared here — a
      // StrictMode double-mount runs this cleanup BETWEEN the two body invokes, so clearing here would
      // wipe the seed on the second (real) invoke. The shared store is cleared only on a genuine
      // `enabled` true→false transition (the `!enabled` branch above) or final unmount (the owning
      // teardown effect below). Bug persist-open-files-restore-broken-v1.
    }
  }, [paneId, enabled, listDir, mirror, apply, setLive, clear])

  // cosmos-terminal-favorite-explorer-share-v1 (FR-002/FR-007): OWNING-side final-unmount teardown.
  // A closed terminal tab (the owner unmounts) must leave NO stale shared-store entry and must release
  // its models so they dispose once no view is attached. A StrictMode dev unmount runs this between
  // the double-mount; the go-live body re-seeds on remount (the restored slice survives in the ref).
  // The MIRROR never owns this (its unmount must not tear down the shared pane state, SC-004/FR-008).
  useEffect(() => {
    if (mirror) {
      return
    }
    return () => {
      for (const rel of openRelsRef.current) {
        sharedMonacoModelRegistry.release(paneId, rel)
      }
      setLive(false)
      clear()
    }
  }, [mirror, paneId, setLive, clear])

  const toggleDir = useCallback(
    (relPath: string): void => {
      const node = findNode(treeRef.current, relPath)
      const willList = node?.kind === 'dir' && !node.expanded && node.children === undefined
      setTree((t) => toggleExpand(t, relPath))
      if (willList) {
        void listDir(relPath, true)
      }
    },
    [listDir]
  )

  // Open `relPath` as a tab OR focus its existing tab (open-or-focus, FR-002/FR-017). A FRESH open
  // appends a `loading` tab to the SHARED store; the owning RESOLVER effect fires the single `fs:read`
  // and lands the resolved content (so a MIRROR-initiated open is resolved by the source — FR-006).
  // Re-clicking an open file just activates it (`openOrFocus` keeps its already-resolved viewer →
  // never `loading` → the resolver skips it: no re-read jolt, FR-009). Works identically from either
  // view (both write the shared store).
  const openFile = useCallback(
    (relPath: string): void => {
      apply((s) => openOrFocus(s, relPath))
    },
    [apply]
  )

  const setActiveFile = useCallback(
    (relPath: string): void => {
      apply((s) => setActiveOpenFile(s, relPath))
    },
    [apply]
  )

  const closeFile = useCallback(
    (relPath: string): void => {
      apply((s) => closeOpenFile(s, relPath))
      // cosmos-terminal-favorite-explorer-share-v1 (FR-007): the file left the SHARED store → release
      // its model so the registry disposes it once no editor view remains attached. Idempotent + safe
      // from either view (the close is shared; whichever view closed it releases the one shared model).
      sharedMonacoModelRegistry.release(paneId, relPath)
    },
    [apply, paneId]
  )

  // file-viewer-multiformat-v1 FR-008: a per-format renderer (PDF/DOCX/SHEET) reported a parse
  // failure on a corrupt file → flip THAT tab to the calm `render-error` block. Reuses the same
  // per-tab `updateOpenFile` isolation as a read resolve, so a sibling tab is never disturbed; a
  // tab closed before the failure landed is a harmless no-op (updateOpenFile discards the patch).
  const markRenderError = useCallback(
    (relPath: string): void => {
      if (!openRelsRef.current.includes(relPath)) {
        return
      }
      apply((s) => updateOpenFile(s, relPath, renderError(relPath)))
    },
    [apply]
  )

  const retryRoot = useCallback((): void => {
    void listDir('', true)
  }, [listDir])

  return {
    tree,
    rootError,
    rootLoading,
    openFiles: openFiles.files,
    activeRelPath: openFiles.activeRelPath,
    viewer: activeViewer(openFiles),
    toggleDir,
    openFile,
    setActiveFile,
    closeFile,
    markRenderError,
    retryRoot
  }
}
