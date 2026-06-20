/**
 * openFiles — PURE, framework-free open-FILES collection for the middle viewer column
 * (terminal-file-tabs-v1, FR-001..FR-007). The #84 viewer held ONE open file; this turns it
 * into a VS Code-style ordered set of open files (each keyed by its root-relative path) plus an
 * active path, so a row of file tabs can sit above the viewer.
 *
 * No React/DOM/Electron import (the `.ts`/`.test.ts` split, CLAUDE.md) so the open/focus/close
 * transitions are node-tested. This is a COLLECTION layer ON TOP of `viewerState.ts` — each open
 * file still carries a `ViewerState` resolved by `selectFile`/`resolveRead`/`invalidateOpen`; this
 * module never reads a file itself.
 *
 * It mirrors the `panelTabs.ts` `TabsState<T>` precedent (ordered tabs + active id, adjacency
 * close), with ONE deliberate delta: `openOrFocus` FOCUSES an already-open path instead of
 * rejecting the duplicate id the way `panelTabs.openTab` does — the strip never holds two tabs for
 * the same path (FR-002). The close-fallback REUSES `panelTabs.adjacentActiveId` so file tabs and
 * terminal tabs close identically (single-sourced adjacency, plan "Single-sourced adjacency" risk).
 *
 * Spec trace (.sdd/specs/terminal-file-tabs-v1.md):
 *   FR-002  openOrFocus — open a new tab + activate, OR focus an already-open one (no duplicate).
 *   FR-003  setActiveFile — activate an existing tab; no open/close.
 *   FR-004  closeFile — remove one; closing the active one activates the adjacency neighbour.
 *   FR-005  closeFile — closing the last one empties the collection (activeRelPath = null).
 *   FR-009  updateOpenFile — patch one file's resolved ViewerState without touching siblings.
 */

import { adjacentActiveId } from '../panelTabs'
import { baseName, selectFile, type ViewerState } from './viewerState'

/** One open file in the strip: its relPath (the stable key), its basename label, and its
 * resolved per-file viewer state (loading/text/image/binary/denied/not-found — never `null`). */
export interface OpenFile {
  /** Root-relative path — the stable key; the collection never holds two for the same path. */
  relPath: string
  /** The basename (the tab label); `viewerState.baseName(relPath)`. */
  name: string
  /** This file's resolved viewer state (the active file's drives the `FileViewer` body). */
  viewer: NonNullable<ViewerState>
}

/** The middle viewer column's open-files collection: an ordered list + the active relPath
 * (`null` only when the list is empty → the "Select a file" placeholder, FR-005). */
export interface OpenFilesState {
  files: OpenFile[]
  activeRelPath: string | null
}

/** The empty collection — no open files, the "Select a file" placeholder showing (FR-005). */
export const EMPTY_OPEN_FILES: OpenFilesState = { files: [], activeRelPath: null }

/**
 * Open `relPath` OR focus it if already open (FR-002). If no tab exists for the path, append a
 * fresh `{ relPath, name, viewer: selectFile(relPath) }` (a `loading` viewer the caller resolves
 * via `updateOpenFile`) and activate it. If a tab already exists, just activate it — NO duplicate.
 * Pure; returns a fresh state. An empty/invalid relPath warns and is a no-op (safe fallback).
 */
export function openOrFocus(
  state: OpenFilesState,
  relPath: string,
  warn: (msg: string) => void = console.warn
): OpenFilesState {
  if (typeof relPath !== 'string' || relPath === '') {
    warn('[openFiles] openOrFocus: relPath must be a non-empty string; ignoring')
    return state
  }
  if (state.files.some((f) => f.relPath === relPath)) {
    // Already open → FOCUS it (the one delta from panelTabs.openTab's reject-duplicate).
    return state.activeRelPath === relPath ? state : { ...state, activeRelPath: relPath }
  }
  const file: OpenFile = { relPath, name: baseName(relPath), viewer: selectFile(relPath) }
  return { files: [...state.files, file], activeRelPath: relPath }
}

/**
 * Make `relPath` the active file (FR-003). Pure; returns a fresh state. Activating a file not in
 * the collection is a no-op that warns (safe fallback). Activating the already-active file returns
 * the unchanged state (referentially stable — no re-open jolt).
 */
export function setActiveFile(
  state: OpenFilesState,
  relPath: string,
  warn: (msg: string) => void = console.warn
): OpenFilesState {
  if (!state.files.some((f) => f.relPath === relPath)) {
    warn(`[openFiles] setActiveFile: no open file "${relPath}"; ignoring`)
    return state
  }
  if (state.activeRelPath === relPath) {
    return state
  }
  return { ...state, activeRelPath: relPath }
}

/**
 * Remove `relPath` from the collection (FR-004/FR-005). Closing an INACTIVE file leaves the active
 * file unchanged. Closing the ACTIVE file re-picks the active path via the SHARED
 * `panelTabs.adjacentActiveId` neighbour rule (right-else-left-else-null), so file tabs and
 * terminal tabs close identically. Closing the last file empties the collection
 * (`activeRelPath = null`). Closing a path not in the collection warns + is a no-op (safe fallback).
 */
export function closeFile(
  state: OpenFilesState,
  relPath: string,
  warn: (msg: string) => void = console.warn
): OpenFilesState {
  if (!state.files.some((f) => f.relPath === relPath)) {
    warn(`[openFiles] closeFile: no open file "${relPath}"; ignoring`)
    return state
  }
  // The adjacency rule keys on `id`; relPath IS the id here. Computed against the list BEFORE
  // removal so adjacency uses the original positions (the panelTabs contract).
  const nextActive = adjacentActiveId(
    state.files.map((f) => ({ id: f.relPath })),
    relPath,
    state.activeRelPath
  )
  return {
    files: state.files.filter((f) => f.relPath !== relPath),
    activeRelPath: nextActive
  }
}

/**
 * Patch a single open file's resolved `ViewerState` (FR-009) — the landing point for the `fs:read`
 * resolve, a watch re-read, or an invalidation. Touches only that file; siblings and the active
 * path are unchanged, so a tab switch never crosses another tab's content. Patching a path not in
 * the collection warns + discards the patch (the file was closed before its read landed).
 */
export function updateOpenFile(
  state: OpenFilesState,
  relPath: string,
  viewer: NonNullable<ViewerState>,
  warn: (msg: string) => void = console.warn
): OpenFilesState {
  const index = state.files.findIndex((f) => f.relPath === relPath)
  if (index === -1) {
    warn(`[openFiles] updateOpenFile: no open file "${relPath}"; discarding patch`)
    return state
  }
  const nextFiles = state.files.slice()
  // Never let a patch change the relPath (the stable key) — keep the original.
  nextFiles[index] = { ...nextFiles[index], viewer, relPath: nextFiles[index].relPath }
  return { ...state, files: nextFiles }
}

/**
 * Seed an `OpenFilesState` from a RESTORED slice (persist-workdir-open-files-v1,
 * FR-004/FR-009/FR-012). Each restored path becomes an open file with a `loading`
 * viewer (the caller resolves it via `fs:read`/`updateOpenFile`, re-reading content
 * from disk — FR-005). Defensive at the boundary: non-string / empty / duplicate paths
 * are dropped; the active path is kept ONLY if it names a surviving file, else it falls
 * back to the first file (or `null` when none survive → the empty "Select a file"
 * placeholder, FR-010). Pure; never throws. A non-slice input → the empty collection.
 */
export function seedOpenFiles(slice: {
  files: unknown
  activeRelPath: unknown
}): OpenFilesState {
  if (!slice || !Array.isArray(slice.files)) {
    return EMPTY_OPEN_FILES
  }
  const seen = new Set<string>()
  const files: OpenFile[] = []
  for (const relPath of slice.files) {
    if (typeof relPath !== 'string' || relPath === '' || seen.has(relPath)) {
      continue
    }
    seen.add(relPath)
    files.push({ relPath, name: baseName(relPath), viewer: selectFile(relPath) })
  }
  if (files.length === 0) {
    return EMPTY_OPEN_FILES
  }
  const activeRelPath =
    typeof slice.activeRelPath === 'string' && seen.has(slice.activeRelPath)
      ? slice.activeRelPath
      : files[0].relPath
  return { files, activeRelPath }
}

/**
 * Decide what a go-live SEED should produce given the still-pending restored slice
 * (persist-workdir-open-files-v1, FR-004). This is the StrictMode-safe replacement for
 * "read the restored ref then null it in the effect body": nulling the source on the first
 * (discarded) invoke of a React StrictMode double-mount makes the SECOND (real) invoke seed
 * EMPTY, wiping the restored files (bug persist-open-files-restore-broken-v1). Keeping the
 * decision PURE — `restored` is only CONSUMED at real teardown, never inside the body — means a
 * benign effect re-run (StrictMode double-invoke, or a stable-dep re-fire) re-seeds the SAME
 * slice idempotently instead of clobbering it.
 *
 * Returns the `OpenFilesState` to seed: the restored slice when one is pending (re-read from disk
 * by the caller), else the empty collection. Pure; never throws.
 */
export function seedOnGoLive(restored: { files: string[]; activeRelPath: string | null } | undefined): OpenFilesState {
  return restored ? seedOpenFiles(restored) : EMPTY_OPEN_FILES
}

/** The active file's resolved `ViewerState`, or `null` when the collection is empty (FR-008 — this
 * is what the `FileViewer` body renders; `null` → the "Select a file" placeholder). */
export function activeViewer(state: OpenFilesState): ViewerState {
  if (state.activeRelPath === null) {
    return null
  }
  const active = state.files.find((f) => f.relPath === state.activeRelPath)
  return active ? active.viewer : null
}
