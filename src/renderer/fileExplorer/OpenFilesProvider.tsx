/**
 * OpenFilesProvider — the App-root, paneId-keyed SHARED open-files store
 * (cosmos-terminal-favorite-explorer-share-v1, FR-002). It lifts a pane's open-files SELECTION (the
 * ordered open files + the active relPath + each file's resolved `ViewerState`) OUT of the per-mount
 * `useFileExplorer` state so MORE THAN ONE explorer VIEW of the same pane (the source Terminal viewer
 * + a Home terminal-favorite viewer) reads + writes ONE selection — identical open tabs + active file,
 * live.
 *
 * Modeled EXACTLY on the sibling `PanelTabsProvider`: a ref-backed registry + a `version` counter, so
 * an `apply`/`setLive`/`clear` swaps the ref and bumps the version (every consumer re-reads) WITHOUT
 * re-rendering unrelated panels. The transitions are the SAME pure `openFiles.ts` ops the single-mount
 * hook already used — only the STORAGE moved here (the lift changes WHERE the state lives, not the
 * logic).
 *
 * Renderer-only (FR-009): this store NEVER crosses IPC, an A2UI surface, or the persisted session. The
 * source pane stays the single owner of `fs:read` resolution + `fs:watch` + the persist/restore seam;
 * this store is just the shared in-renderer reference both views read.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { EMPTY_OPEN_FILES, type OpenFilesState } from './openFiles'

/** One pane's shared open-files entry: its selection + whether the OWNING pane is folder-open. */
export interface PaneOpenFilesEntry {
  /** The ordered open files + active relPath (the lifted `useFileExplorer` selection). */
  openFiles: OpenFilesState
  /**
   * True while the OWNING pane is live (a folder is open), set by the owning hook. The mirror reads
   * it to choose the explorer split vs. a calm "no folder open" placeholder (folder-open is a
   * source-owned action — the mirror never opens a folder).
   */
  live: boolean
}

/** The default entry for a pane with no store row yet (empty selection, not live). */
const EMPTY_ENTRY: PaneOpenFilesEntry = { openFiles: EMPTY_OPEN_FILES, live: false }

type Registry = Map<string, PaneOpenFilesEntry>

interface OpenFilesContextValue {
  /** The live store (read by each explorer view). */
  registryRef: React.MutableRefObject<Registry>
  /** Bumped on every apply/setLive/clear so consumers re-read. */
  version: number
  /** Run a pure `openFiles.ts` transition against a pane's selection + bump the version. */
  apply: (paneId: string, fn: (state: OpenFilesState) => OpenFilesState) => void
  /** Set a pane's owning-liveness flag. */
  setLive: (paneId: string, live: boolean) => void
  /** Remove a pane's entry (owning teardown). */
  clear: (paneId: string) => void
}

const OpenFilesContext = createContext<OpenFilesContextValue | null>(null)

/**
 * Provide the shared open-files store to the App shell + every explorer view. Render high enough to
 * wrap BOTH the Terminal panel (the source explorer) and Home (the favorite explorer) — both are
 * `forceMount`ed, so both `useFileExplorer` instances stay mounted and share one store per paneId.
 */
export function OpenFilesProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const registryRef = useRef<Registry>(new Map())
  const [version, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((v) => v + 1), [])

  const apply = useCallback(
    (paneId: string, fn: (state: OpenFilesState) => OpenFilesState): void => {
      const prev = registryRef.current.get(paneId) ?? EMPTY_ENTRY
      const nextOpenFiles = fn(prev.openFiles)
      // The pure transitions return the SAME reference for a no-op (e.g. focusing the already-active
      // file) — skip the swap + bump so a no-op never churns every consumer (matches single-mount).
      if (nextOpenFiles === prev.openFiles) {
        return
      }
      const next = new Map(registryRef.current)
      next.set(paneId, { ...prev, openFiles: nextOpenFiles })
      registryRef.current = next
      bump()
    },
    [bump]
  )

  const setLive = useCallback(
    (paneId: string, live: boolean): void => {
      const prev = registryRef.current.get(paneId) ?? EMPTY_ENTRY
      if (prev.live === live) {
        return
      }
      const next = new Map(registryRef.current)
      next.set(paneId, { ...prev, live })
      registryRef.current = next
      bump()
    },
    [bump]
  )

  const clear = useCallback(
    (paneId: string): void => {
      if (!registryRef.current.has(paneId)) {
        return
      }
      const next = new Map(registryRef.current)
      next.delete(paneId)
      registryRef.current = next
      bump()
    },
    [bump]
  )

  const value = useMemo<OpenFilesContextValue>(
    () => ({ registryRef, version, apply, setLive, clear }),
    [version, apply, setLive, clear]
  )
  return <OpenFilesContext.Provider value={value}>{children}</OpenFilesContext.Provider>
}

function useOpenFilesContext(): OpenFilesContextValue {
  const ctx = useContext(OpenFilesContext)
  if (!ctx) {
    throw new Error('useSharedOpenFiles must be used within an OpenFilesProvider')
  }
  return ctx
}

/** The per-pane handle a consumer gets from {@link useSharedOpenFiles}. */
export interface SharedOpenFiles {
  /** This pane's shared entry (selection + owning-liveness), re-read on every store change. */
  entry: PaneOpenFilesEntry
  /** Run a pure `openFiles.ts` transition against THIS pane's selection. */
  apply: (fn: (state: OpenFilesState) => OpenFilesState) => void
  /** Set THIS pane's owning-liveness flag (owning hook only). */
  setLive: (live: boolean) => void
  /** Remove THIS pane's entry (owning teardown). */
  clear: () => void
}

/**
 * Bind to one pane's shared open-files entry. The entry re-reads on every store change (`version`
 * drives the memo — the registry itself is a ref, swapped on each apply). The returned `apply`/
 * `setLive`/`clear` are bound to `paneId`. Both the source `useFileExplorer` and the mirror call
 * this for the SAME paneId, so they read + write one selection.
 */
export function useSharedOpenFiles(paneId: string): SharedOpenFiles {
  const { registryRef, version, apply: applyPane, setLive: setLivePane, clear: clearPane } =
    useOpenFilesContext()
  const entry = useMemo(
    () => registryRef.current.get(paneId) ?? EMPTY_ENTRY,
    // `version` drives the re-read (the registry is a ref, swapped on each store change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registryRef, version, paneId]
  )
  const apply = useCallback(
    (fn: (state: OpenFilesState) => OpenFilesState) => applyPane(paneId, fn),
    [applyPane, paneId]
  )
  const setLive = useCallback((live: boolean) => setLivePane(paneId, live), [setLivePane, paneId])
  const clear = useCallback(() => clearPane(paneId), [clearPane, paneId])
  return { entry, apply, setLive, clear }
}
