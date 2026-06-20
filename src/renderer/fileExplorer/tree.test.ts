import { describe, it, expect } from 'vitest'
import {
  compareEntries,
  expandedDirPaths,
  findNode,
  joinRel,
  makeRoot,
  mergeListing,
  sortEntries,
  toggleExpand,
  visibleRows
} from './tree'
import type { FsEntry } from '../../shared/ipc'

/*
 * tree — PURE file-explorer tree state (terminal-file-explorer-v1, FR-004/FR-005/FR-014).
 * No React/DOM (node env). Proves the deterministic sort, lazy expand/skeleton, and the
 * SEAMLESS watch-driven merge (design §6): a re-list preserves expansion + node identity
 * for unchanged subtrees and drops vanished entries.
 */

const ent = (name: string, kind: 'file' | 'dir', isSymlink = false): FsEntry => ({
  name,
  kind,
  isSymlink
})

describe('joinRel', () => {
  it('joins under the root and under a nested dir', () => {
    expect(joinRel('', 'a.ts')).toBe('a.ts')
    expect(joinRel('src', 'a.ts')).toBe('src/a.ts')
    expect(joinRel('src/img', 'logo.png')).toBe('src/img/logo.png')
  })
})

describe('compareEntries / sortEntries (FR-005)', () => {
  it('orders dirs before files, then alpha case-insensitive', () => {
    const out = sortEntries([
      ent('banana.txt', 'file'),
      ent('Zebra', 'dir'),
      ent('apple.ts', 'file'),
      ent('alpha', 'dir')
    ])
    expect(out.map((e) => e.name)).toEqual(['alpha', 'Zebra', 'apple.ts', 'banana.txt'])
  })

  it('has a stable case-sensitive tiebreak for ci-equal names', () => {
    // `A` vs `a` are ci-equal; the tiebreak is deterministic (uppercase `A` < `a`).
    expect(compareEntries(ent('A', 'file'), ent('a', 'file'))).toBeLessThan(0)
    expect(compareEntries(ent('a', 'file'), ent('A', 'file'))).toBeGreaterThan(0)
  })

  it('does not mutate the input array', () => {
    const input = [ent('b', 'file'), ent('a', 'file')]
    const before = input.map((e) => e.name)
    sortEntries(input)
    expect(input.map((e) => e.name)).toEqual(before)
  })
})

describe('makeRoot', () => {
  it('builds an expanded root with no listed children', () => {
    const root = makeRoot()
    expect(root).toMatchObject({ relPath: '', depth: 0, kind: 'dir', expanded: true })
    expect(root.children).toBeUndefined()
  })
})

describe('mergeListing — first list', () => {
  it('populates the root with sorted children, clearing loading', () => {
    let root = makeRoot()
    root = { ...root, loading: true }
    root = mergeListing(root, '', [ent('b.ts', 'file'), ent('src', 'dir')])
    expect(root.loading).toBe(false)
    expect((root.children ?? []).map((c) => c.relPath)).toEqual(['src', 'b.ts'])
    // children start collapsed/unlisted.
    const src = findNode(root, 'src')!
    expect(src.expanded).toBe(false)
    expect(src.children).toBeUndefined()
  })
})

describe('mergeListing — seamless re-list (design §6, FR-014)', () => {
  it('preserves an expanded subtree across a re-list (identity + expansion held)', () => {
    let root = mergeListing(makeRoot(), '', [ent('src', 'dir'), ent('a.ts', 'file')])
    root = toggleExpand(root, 'src') // expand src
    root = mergeListing(root, 'src', [ent('deep', 'dir')]) // list src
    root = toggleExpand(root, 'src/deep') // expand src/deep
    const deepBefore = findNode(root, 'src/deep')!

    // A watch fires → re-list the root. `src` must stay expanded with its subtree intact.
    const root2 = mergeListing(root, '', [ent('src', 'dir'), ent('a.ts', 'file'), ent('new.md', 'file')])
    const srcAfter = findNode(root2, 'src')!
    expect(srcAfter.expanded).toBe(true)
    // Same subtree node object preserved by identity (seamless re-render).
    expect(findNode(root2, 'src/deep')).toBe(deepBefore)
    // The new sibling appears at its sorted position (after src, dirs-first; files alpha).
    expect((root2.children ?? []).map((c) => c.relPath)).toEqual(['src', 'a.ts', 'new.md'])
  })

  it('drops a vanished entry (delete/rename) on re-list', () => {
    let root = mergeListing(makeRoot(), '', [ent('keep.ts', 'file'), ent('gone.ts', 'file')])
    root = mergeListing(root, '', [ent('keep.ts', 'file')])
    expect(findNode(root, 'gone.ts')).toBeNull()
    expect(findNode(root, 'keep.ts')).not.toBeNull()
  })

  it('replaces a node whose KIND changed (file→dir) rather than keeping the stale one', () => {
    let root = mergeListing(makeRoot(), '', [ent('x', 'file')])
    root = mergeListing(root, '', [ent('x', 'dir')])
    expect(findNode(root, 'x')!.kind).toBe('dir')
  })

  it('returns the tree unchanged when the listed dir is not present', () => {
    const root = mergeListing(makeRoot(), '', [ent('a.ts', 'file')])
    const same = mergeListing(root, 'does/not/exist', [ent('z', 'file')])
    expect(same).toBe(root)
  })
})

describe('toggleExpand — lazy skeleton (design §2.3)', () => {
  it('sets loading on FIRST expand (children unlisted), not on re-expand', () => {
    let root = mergeListing(makeRoot(), '', [ent('src', 'dir')])
    root = toggleExpand(root, 'src')
    expect(findNode(root, 'src')!.loading).toBe(true) // first expand → skeleton

    root = mergeListing(root, 'src', [ent('a.ts', 'file')]) // list clears loading
    root = toggleExpand(root, 'src') // collapse (keeps children cached)
    root = toggleExpand(root, 'src') // re-expand
    expect(findNode(root, 'src')!.loading).toBe(false) // already listed → no skeleton
  })

  it('does nothing to a file node', () => {
    let root = mergeListing(makeRoot(), '', [ent('a.ts', 'file')])
    const before = findNode(root, 'a.ts')!
    root = toggleExpand(root, 'a.ts')
    expect(findNode(root, 'a.ts')).toEqual(before)
  })
})

describe('expandedDirPaths', () => {
  it('lists the root + every expanded descendant dir to re-list on a watch event', () => {
    let root = mergeListing(makeRoot(), '', [ent('src', 'dir'), ent('docs', 'dir')])
    root = toggleExpand(root, 'src')
    root = mergeListing(root, 'src', [ent('sub', 'dir')])
    root = toggleExpand(root, 'src/sub')
    // docs stays collapsed → not listed.
    expect(expandedDirPaths(root).sort()).toEqual(['', 'src', 'src/sub'])
  })
})

describe('visibleRows', () => {
  it('flattens only expanded subtrees, root excluded, in sorted order', () => {
    let root = mergeListing(makeRoot(), '', [ent('src', 'dir'), ent('a.ts', 'file')])
    root = toggleExpand(root, 'src')
    root = mergeListing(root, 'src', [ent('b.ts', 'file')])
    expect(visibleRows(root).map((r) => r.relPath)).toEqual(['src', 'src/b.ts', 'a.ts'])

    // Collapsing src hides its children.
    root = toggleExpand(root, 'src')
    expect(visibleRows(root).map((r) => r.relPath)).toEqual(['src', 'a.ts'])
  })
})

describe('findNode — open-file invalidation (FR-017)', () => {
  it('returns null once an open file is deleted from the tree', () => {
    let root = mergeListing(makeRoot(), '', [ent('open.ts', 'file')])
    expect(findNode(root, 'open.ts')).not.toBeNull()
    root = mergeListing(root, '', []) // file deleted on disk → re-list drops it
    expect(findNode(root, 'open.ts')).toBeNull()
  })
})
