/**
 * tree — PURE tree state for the file explorer (terminal-file-explorer-v1, FR-004/FR-005/
 * FR-014). No React, no DOM import (the `.ts`/`.test.ts` split) — node-unit-testable; the
 * vitest node env runs it directly. It owns the deterministic sort + the seamless
 * watch-driven MERGE (design §6: re-list keeps expansion, identity, and order).
 *
 * The renderer addresses every node by its root-RELATIVE path (`relPath`); `''` is the
 * root. A directory's children are listed lazily on first expand and re-listed (merged)
 * on a watch change. This module never touches the filesystem or IPC — the hook
 * (`useFileExplorer`) drives it with `FsEntry[]` from `fs:list`.
 */

import type { FsEntry } from '../../shared/ipc'

/**
 * A single tree node the rows render from. `relPath` is the stable identity (root-relative,
 * `/`-joined; `''` = root). `children` is `undefined` until the directory has been listed
 * (lazy), then an ordered array (possibly empty for an empty directory). `expanded` gates
 * whether children show; `loading` flags a first-list/expand in flight (design §2.3).
 */
export interface TreeNode {
  /** Root-relative path; the stable identity. `''` for the root. */
  relPath: string
  /** Basename shown in the row (`''` for the root — the header shows the root label). */
  name: string
  kind: 'file' | 'dir'
  isSymlink: boolean
  /** Depth from the root (root = 0); drives the row indent. */
  depth: number
  /** Directory expansion state (files are never expanded). */
  expanded: boolean
  /** True while this directory's first `fs:list` is outstanding (skeleton; design §2.3). */
  loading: boolean
  /** Listed children (lazy): `undefined` = not yet listed; `[]` = listed + empty. */
  children?: TreeNode[]
}

/** Join a parent relPath + a child name into the child's relPath. The root (`''`) yields
 * just the name; deeper nodes join with `/`. Pure. */
export function joinRel(parentRel: string, name: string): string {
  return parentRel === '' ? name : `${parentRel}/${name}`
}

/**
 * Deterministic sort comparator (FR-005): directories first, then files, each alphabetical
 * case-INsensitive, with a stable case-sensitive tiebreak so `A` vs `a` is deterministic.
 * Mirrors main's list order (both sort the same way). Pure.
 */
export function compareEntries(
  a: { name: string; kind: 'file' | 'dir' },
  b: { name: string; kind: 'file' | 'dir' }
): number {
  if (a.kind !== b.kind) {
    return a.kind === 'dir' ? -1 : 1
  }
  const an = a.name.toLowerCase()
  const bn = b.name.toLowerCase()
  if (an < bn) {
    return -1
  }
  if (an > bn) {
    return 1
  }
  // Case-insensitive tie — stable, deterministic case-sensitive tiebreak.
  if (a.name < b.name) {
    return -1
  }
  if (a.name > b.name) {
    return 1
  }
  return 0
}

/** Sort a copy of `entries` per {@link compareEntries} (dirs-first, alpha, ci). Pure. */
export function sortEntries(entries: FsEntry[]): FsEntry[] {
  return [...entries].sort(compareEntries)
}

/** Build the root node — an expanded directory whose children are not yet listed. The root
 * is expanded by default so its first list populates the top level. Pure. */
export function makeRoot(): TreeNode {
  return {
    relPath: '',
    name: '',
    kind: 'dir',
    isSymlink: false,
    depth: 0,
    expanded: true,
    loading: false,
    children: undefined
  }
}

/**
 * Build a fresh child node for `entry` under `parent`. A directory starts collapsed with
 * unlisted children; a file is a leaf. Pure.
 */
function makeChild(parent: TreeNode, entry: FsEntry): TreeNode {
  return {
    relPath: joinRel(parent.relPath, entry.name),
    name: entry.name,
    kind: entry.kind,
    isSymlink: entry.isSymlink,
    depth: parent.depth + 1,
    expanded: false,
    loading: false,
    children: entry.kind === 'dir' ? undefined : undefined
  }
}

/**
 * MERGE a fresh `fs:list` result for `dirRelPath` into `root` (FR-014, design §6 —
 * seamless). Returns a NEW root (immutable update) in which the listed directory's
 * children become the sorted `entries`, but EXISTING child subtrees are PRESERVED by
 * identity: a child that is still present keeps its `expanded` state and its own
 * (recursively-untouched) `children`, so an expanded folder stays expanded and its scroll/
 * selection hold. New entries are inserted (collapsed/unlisted) at their sorted position;
 * vanished entries are dropped (a delete/rename). The directory's `loading` is cleared.
 *
 * If `dirRelPath` is not found in the tree (e.g. it collapsed away before the list
 * returned), the tree is returned unchanged. Pure — never mutates the input.
 */
export function mergeListing(root: TreeNode, dirRelPath: string, entries: FsEntry[]): TreeNode {
  return updateNode(root, dirRelPath, (dir) => {
    if (dir.kind !== 'dir') {
      return dir
    }
    const prevByRel = new Map((dir.children ?? []).map((c) => [c.relPath, c]))
    const sorted = sortEntries(entries)
    const nextChildren = sorted.map((entry) => {
      const rel = joinRel(dir.relPath, entry.name)
      const prev = prevByRel.get(rel)
      if (prev && prev.kind === entry.kind) {
        // Same node still present — keep its expansion + subtree; refresh the symlink flag.
        return { ...prev, isSymlink: entry.isSymlink, depth: dir.depth + 1 }
      }
      return makeChild(dir, entry)
    })
    return { ...dir, children: nextChildren, loading: false }
  })
}

/**
 * Toggle a directory node's `expanded` flag (FR-004). Collapsing keeps its listed children
 * cached (so re-expanding is instant); expanding sets `loading` true ONLY when the children
 * are not yet listed (first expand → skeleton; design §2.3) so a re-expand of an already-
 * listed folder shows no skeleton. A file node is returned unchanged. Pure.
 */
export function toggleExpand(root: TreeNode, dirRelPath: string): TreeNode {
  return updateNode(root, dirRelPath, (node) => {
    if (node.kind !== 'dir') {
      return node
    }
    const nextExpanded = !node.expanded
    const needsLoad = nextExpanded && node.children === undefined
    return { ...node, expanded: nextExpanded, loading: needsLoad ? true : node.loading }
  })
}

/** Mark a directory `loading` (the skeleton state) ahead of its first `fs:list`. Pure. */
export function setLoading(root: TreeNode, dirRelPath: string, loading: boolean): TreeNode {
  return updateNode(root, dirRelPath, (node) =>
    node.kind === 'dir' ? { ...node, loading } : node
  )
}

/**
 * Find a node by `relPath`, or `null` if it is not present (e.g. deleted, or under an
 * unlisted/collapsed ancestor). Used to invalidate the open file on delete (FR-017). Pure.
 */
export function findNode(root: TreeNode, relPath: string): TreeNode | null {
  if (root.relPath === relPath) {
    return root
  }
  for (const child of root.children ?? []) {
    const found = findNode(child, relPath)
    if (found) {
      return found
    }
  }
  return null
}

/** The relPaths of every currently-expanded directory (root included), so the hook knows
 * which directories to re-list on a watch change (design §6). Pure. */
export function expandedDirPaths(root: TreeNode): string[] {
  const out: string[] = []
  const walk = (node: TreeNode): void => {
    if (node.kind === 'dir' && node.expanded) {
      out.push(node.relPath)
      for (const child of node.children ?? []) {
        walk(child)
      }
    }
  }
  walk(root)
  return out
}

/**
 * Flatten the tree into the visible, ordered list of rows the explorer renders: the root's
 * children, then recursively the children of every EXPANDED directory (the root itself is
 * not a row — its label is the header). Order matches the sorted children at each level, so
 * the rendered order is deterministic (FR-005). Pure.
 */
export function visibleRows(root: TreeNode): TreeNode[] {
  const out: TreeNode[] = []
  const walk = (node: TreeNode): void => {
    for (const child of node.children ?? []) {
      out.push(child)
      if (child.kind === 'dir' && child.expanded) {
        walk(child)
      }
    }
  }
  walk(root)
  return out
}

/**
 * Immutable single-node update: return a new tree where the node at `relPath` is replaced
 * by `fn(node)`, sharing every untouched subtree by reference (so React identity is stable
 * for unchanged rows — seamless re-render, design §6). The input is never mutated. Pure.
 */
export function updateNode(
  root: TreeNode,
  relPath: string,
  fn: (node: TreeNode) => TreeNode
): TreeNode {
  if (root.relPath === relPath) {
    return fn(root)
  }
  if (!root.children) {
    return root
  }
  let changed = false
  const nextChildren = root.children.map((child) => {
    const updated = updateNode(child, relPath, fn)
    if (updated !== child) {
      changed = true
    }
    return updated
  })
  return changed ? { ...root, children: nextChildren } : root
}
