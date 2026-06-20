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
  invalidateOpen,
  resolveRead,
  type ViewerState
} from './viewerState'
import {
  activeViewer,
  closeFile as closeOpenFile,
  EMPTY_OPEN_FILES,
  openOrFocus,
  seedOnGoLive,
  setActiveFile as setActiveOpenFile,
  updateOpenFile,
  type OpenFile,
  type OpenFilesState
} from './openFiles'

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
  /** Re-list the root (the §2.3 Retry button). */
  retryRoot: () => void
}

/**
 * Drive the file explorer for one tab. `enabled` is the tab's LIVE phase (a chosen cwd);
 * while false the hook is inert (no list/watch). `paneId` routes every `fs:*` call to the
 * tab's root.
 *
 * persist-workdir-open-files-v1: `restoredOpenFiles` is the persisted open-files slice for
 * this pane (FR-004), seeded ONCE on the first go-live (content re-read from disk — FR-005);
 * `onOpenFilesChange` reports every open-files change to the debounced session save (FR-013).
 */
export function useFileExplorer(
  paneId: string,
  enabled: boolean,
  restoredOpenFiles?: RestoredOpenFiles,
  onOpenFilesChange?: (slice: RestoredOpenFiles) => void
): UseFileExplorer {
  const [tree, setTree] = useState<TreeNode>(makeRoot)
  const [rootError, setRootError] = useState<RootError>(null)
  const [rootLoading, setRootLoading] = useState(false)
  // terminal-file-tabs-v1: the middle column now holds an ORDERED collection of open files + an
  // active path (was a single `viewer: ViewerState`). The active file's viewer drives the body.
  const [openFiles, setOpenFiles] = useState<OpenFilesState>(EMPTY_OPEN_FILES)

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

  // persist-workdir-open-files-v1 FR-013: report the open-files slice on every change so the
  // debounced session save captures the latest set + active path. Reuses the existing save
  // pipeline (no new persistence mechanism). Only meaningful while live; while inert the
  // collection is empty (the report is harmless — it omits an empty slice at the draft).
  useEffect(() => {
    onChangeRef.current?.({
      files: openFiles.files.map((f) => f.relPath),
      activeRelPath: openFiles.activeRelPath
    })
  }, [openFiles])

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

  // Go-live: list the root + start the watcher. Teardown / disable: stop the watcher and
  // reset to an empty tree (a re-enabled or re-rooted tab lists fresh). FR-006/FR-015/FR-016.
  useEffect(() => {
    if (!enabled) {
      // The live phase genuinely ended (re-root / disable) — consume the restored slice so a later
      // re-enter starts empty, not with stale paths. A StrictMode remount keeps `enabled` true, so
      // it never reaches here between the double-invoke (the seed survives — see ref note above).
      if (wasEnabledRef.current) {
        restoredOpenFilesRef.current = undefined
        wasEnabledRef.current = false
      }
      return
    }
    wasEnabledRef.current = true
    setTree(makeRoot())
    // persist-workdir-open-files-v1 FR-004: on go-live, SEED the open-files collection from this
    // pane's persisted slice (consumed once — a later re-enter starts empty), instead of the
    // old terminal-file-tabs-v1 unconditional wipe. Each restored file starts `loading`; we then
    // fire an `fs:read` per path to re-read its content from disk (FR-005 — contents are never
    // persisted). A `not-found` read flips THAT file to the calm "no longer available" state
    // (FR-008) without disturbing siblings; the active path already fell back safely at seed
    // time if it had vanished (FR-009). A pane with no persisted slice seeds empty (the strip
    // shows the "Select a file" placeholder — FR-010).
    // Read the restored slice WITHOUT clearing it here — it is consumed only on a genuine
    // `enabled` true→false transition (the `!enabled` branch above). A StrictMode double-invoke
    // re-runs this body with the SAME slice and re-seeds idempotently instead of wiping to EMPTY
    // (bug persist-open-files-restore-broken-v1).
    const restored = restoredOpenFilesRef.current
    const seeded = seedOnGoLive(restored)
    setOpenFiles(seeded)
    for (const seededRel of seeded.files.map((f) => f.relPath)) {
      void window.cosmos.fs.read(paneId, seededRel).then((res) => {
        // Skip if the tab was closed before the read landed (no longer open).
        if (!openRelsRef.current.includes(seededRel)) {
          return
        }
        // `resolveRead` maps ok → text/image and every benign failure (not-found/denied/binary)
        // to its calm block — a vanished restored file lands as "no longer available" (FR-008).
        setOpenFiles((s) => updateOpenFile(s, seededRel, resolveRead(seededRel, res)))
      })
    }
    void listDir('', true)
    window.cosmos.fs.watchStart(paneId)
    const off = window.cosmos.fs.onChanged((payload) => {
      if (payload.paneId !== paneId) {
        return
      }
      // SEAMLESS re-list (§6): re-list every currently-expanded directory (no skeleton) and
      // merge. Then re-read every OPEN file; a vanished one flips THAT tab to "no longer
      // available" (FR-010) without disturbing the others.
      const dirs = expandedDirPaths(treeRef.current)
      for (const dir of dirs) {
        void listDir(dir, false)
      }
      for (const openRel of openRelsRef.current) {
        // Re-read each open file: a vanished read invalidates only that tab (FR-010). Coarse but
        // cheap (one read per open file per change). ponytail: re-read all open on every change.
        void window.cosmos.fs.read(paneId, openRel).then((res) => {
          // Skip if the tab was closed before the read landed (no longer open).
          if (!openRelsRef.current.includes(openRel)) {
            return
          }
          if (!res.ok && res.reason === 'not-found') {
            setOpenFiles((s) => updateOpenFile(s, openRel, invalidateOpen(openRel)))
          }
        })
      }
    })
    return () => {
      off()
      window.cosmos.fs.watchStop(paneId)
      // NOTE: the restored slice is intentionally NOT consumed here — a StrictMode double-mount runs
      // this cleanup BETWEEN the two body invokes, so clearing it here would wipe the seed on the
      // second (real) invoke. It is consumed only on a genuine `enabled` true→false transition (the
      // `!enabled` branch above), bug persist-open-files-restore-broken-v1.
    }
  }, [paneId, enabled, listDir])

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

  // Open `relPath` as a tab OR focus its existing tab (open-or-focus, FR-002/FR-017). On a FRESH
  // open (not already in the collection) the new tab shows its `loading` viewer immediately, then
  // `fs:read` resolves into the content/calm state via `updateOpenFile`. Re-clicking an open file
  // just activates it (no re-read jolt) — `openOrFocus` preserves its already-resolved viewer.
  const openFile = useCallback(
    (relPath: string): void => {
      const wasOpen = openRelsRef.current.includes(relPath)
      setOpenFiles((s) => openOrFocus(s, relPath))
      if (wasOpen) {
        return // already open → focused; its resolved viewer is reused (FR-009).
      }
      void window.cosmos.fs.read(paneId, relPath).then((res) => {
        // Land the read only if the tab is still open (the user may have closed it first).
        if (!openRelsRef.current.includes(relPath)) {
          return
        }
        setOpenFiles((s) => updateOpenFile(s, relPath, resolveRead(relPath, res)))
      })
    },
    [paneId]
  )

  const setActiveFile = useCallback((relPath: string): void => {
    setOpenFiles((s) => setActiveOpenFile(s, relPath))
  }, [])

  const closeFile = useCallback((relPath: string): void => {
    setOpenFiles((s) => closeOpenFile(s, relPath))
  }, [])

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
    retryRoot
  }
}
