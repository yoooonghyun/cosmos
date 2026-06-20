/**
 * FileTree — the right-pane file tree (terminal-file-explorer-v1, FR-004/FR-005, design §2).
 * A `role="tree"` of `role="treeitem"` rows over the pure `tree.ts` state: directories
 * disclose/collapse, files open the viewer. Read-only — no write affordances.
 *
 * A11y (design §8): roving tabindex (one row `tabIndex={0}`, the rest `-1`); the standard ARIA
 * tree keymap — Up/Down move focus, Right expands / descends, Left collapses / ascends,
 * Enter/Space activates (toggle dir / open file), Home/End jump. Selection (`data-selected`)
 * is the keyboard-focused row or the open file's row.
 *
 * Rows are flattened by `visibleRows` (only expanded dirs contribute children), so this
 * component just renders the given order — the deterministic dirs-first/alpha sort lives in
 * `tree.ts` (and mirrors main). Skeletons show only on a FIRST list (root or first expand),
 * never on a watch re-list (the merge is seamless — the hook never re-sets loading on re-list).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  TriangleAlert
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { fileGlyphKind, type FileGlyphKind } from './fileGlyph'
import { findNode, visibleRows, type TreeNode } from './tree'
import type { RootError } from './useFileExplorer'

/** The lucide glyph for a FILE row, by its classified kind (design §2.2). */
const FILE_GLYPH: Record<FileGlyphKind, typeof File> = {
  code: FileCode,
  image: FileImage,
  text: FileText,
  file: File
}

/** A single tree row. `role="treeitem"`; the whole row toggles a dir / opens a file. */
function FileTreeRow({
  node,
  selected,
  focused,
  onActivate,
  onFocus
}: {
  node: TreeNode
  selected: boolean
  focused: boolean
  onActivate: (node: TreeNode) => void
  onFocus: (relPath: string) => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  // Pull focus to the roving-active row when it changes (so arrow nav moves the DOM focus).
  useEffect(() => {
    if (focused) {
      ref.current?.focus()
    }
  }, [focused])

  const isDir = node.kind === 'dir'
  const Glyph = isDir ? (node.expanded ? FolderOpen : Folder) : FILE_GLYPH[fileGlyphKind(node.name)]
  const Chevron = node.expanded ? ChevronDown : ChevronRight

  const row = (
    <div
      ref={ref}
      role="treeitem"
      aria-level={node.depth}
      aria-expanded={isDir ? node.expanded : undefined}
      aria-selected={selected}
      aria-description={node.isSymlink ? 'symlink' : undefined}
      tabIndex={focused ? 0 : -1}
      data-selected={selected || undefined}
      onClick={() => onActivate(node)}
      onFocus={() => onFocus(node.relPath)}
      style={{ paddingLeft: node.depth * 12 + 8 }}
      className={cn(
        'group/row flex h-7 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-sm pr-2 text-[13px] text-foreground/90 outline-none select-none',
        'hover:bg-accent',
        'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset',
        'data-[selected=true]:bg-accent data-[selected=true]:text-foreground'
      )}
    >
      {/* Disclosure: chevron for dirs, an empty spacer for files (so names align). */}
      <span className="flex size-4 shrink-0 items-center justify-center">
        {isDir ? (
          <Chevron className="size-3.5 text-muted-foreground" aria-hidden="true" />
        ) : null}
      </span>
      <Glyph className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className={cn('min-w-0 truncate', node.isSymlink && 'italic text-muted-foreground')}>
        {node.name}
      </span>
    </div>
  )

  // Tooltip shows the full name (truncated rows) / the symlink hint (design §2.2).
  return (
    <Tooltip>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent side="right">
        {node.name}
        {node.isSymlink ? ' (symlink)' : ''}
      </TooltipContent>
    </Tooltip>
  )
}

export function FileTree({
  tree,
  rootError,
  rootLoading,
  selectedRelPath,
  onToggleDir,
  onOpenFile,
  onRetry
}: {
  tree: TreeNode
  rootError: RootError
  rootLoading: boolean
  /** The relPath of the open file (or null) — its row renders selected. */
  selectedRelPath: string | null
  onToggleDir: (relPath: string) => void
  onOpenFile: (relPath: string) => void
  onRetry: () => void
}): React.JSX.Element {
  const rows = useMemo(() => visibleRows(tree), [tree])
  // The roving-active row's relPath (the one `tabIndex={0}`). Defaults to the first row.
  const [activeRel, setActiveRel] = useState<string | null>(null)
  const effectiveActive = activeRel ?? selectedRelPath ?? rows[0]?.relPath ?? null

  const activate = useCallback(
    (node: TreeNode): void => {
      setActiveRel(node.relPath)
      if (node.kind === 'dir') {
        onToggleDir(node.relPath)
      } else {
        onOpenFile(node.relPath)
      }
    },
    [onToggleDir, onOpenFile]
  )

  // The standard ARIA tree keymap (design §8) over the flattened visible rows.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): void => {
      if (rows.length === 0) {
        return
      }
      const idx = Math.max(0, rows.findIndex((r) => r.relPath === effectiveActive))
      const node = rows[idx]
      const move = (next: number): void => {
        e.preventDefault()
        setActiveRel(rows[Math.max(0, Math.min(rows.length - 1, next))].relPath)
      }
      switch (e.key) {
        case 'ArrowDown':
          move(idx + 1)
          break
        case 'ArrowUp':
          move(idx - 1)
          break
        case 'Home':
          move(0)
          break
        case 'End':
          move(rows.length - 1)
          break
        case 'ArrowRight':
          e.preventDefault()
          if (node.kind === 'dir' && !node.expanded) {
            onToggleDir(node.relPath)
          } else if (node.kind === 'dir' && node.expanded && idx + 1 < rows.length) {
            // Already expanded → descend into the first child.
            setActiveRel(rows[idx + 1].relPath)
          }
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (node.kind === 'dir' && node.expanded) {
            onToggleDir(node.relPath)
          } else {
            // Move to the parent (the nearest preceding row one level shallower).
            for (let i = idx - 1; i >= 0; i--) {
              if (rows[i].depth < node.depth) {
                setActiveRel(rows[i].relPath)
                break
              }
            }
          }
          break
        case 'Enter':
        case ' ':
          e.preventDefault()
          activate(node)
          break
        default:
          break
      }
    },
    [rows, effectiveActive, onToggleDir, activate]
  )

  if (rootError !== null) {
    // §2.3 error: the house Notice (Alert destructive) + Retry. Terminal pane unaffected.
    const reason =
      rootError === 'denied'
        ? 'You don’t have permission to read this folder.'
        : rootError === 'not-found'
          ? 'This folder is no longer available.'
          : 'This folder is outside the allowed root.'
    return (
      <div className="p-3">
        <Alert variant="destructive" className="border-destructive/40 bg-destructive/15">
          <TriangleAlert />
          <AlertTitle>Couldn’t read this folder.</AlertTitle>
          <AlertDescription>
            <p>{reason}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  if (rootLoading) {
    // §2.3 first-list skeleton: stacked bars at row height with varied widths + indent.
    const widths = ['60%', '45%', '70%', '50%', '65%', '40%', '55%']
    const indents = [8, 8, 20, 20, 8, 20, 8]
    return (
      <div className="py-1" aria-busy="true">
        {widths.map((w, i) => (
          <Skeleton
            key={i}
            className="my-[7px] h-3.5"
            style={{ width: w, marginLeft: indents[i], marginRight: 8 }}
          />
        ))}
      </div>
    )
  }

  if (rows.length === 0) {
    // §2.3 empty root.
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <FolderOpen className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-xs text-muted-foreground">This folder is empty.</p>
      </div>
    )
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div role="tree" aria-label="File explorer" className="py-1" onKeyDown={onKeyDown}>
        {rows.map((node) => {
          // An expanded directory listed empty shows a single muted "Empty" child line.
          const isEmptyExpandedDir =
            node.kind === 'dir' && node.expanded && node.children?.length === 0
          return (
            <div key={node.relPath}>
              <FileTreeRow
                node={node}
                selected={node.relPath === selectedRelPath || node.relPath === effectiveActive}
                focused={node.relPath === effectiveActive}
                onActivate={activate}
                onFocus={setActiveRel}
              />
              {isEmptyExpandedDir ? (
                <p
                  className="px-2 py-1 text-xs text-muted-foreground italic"
                  style={{ paddingLeft: (node.depth + 1) * 12 + 8 }}
                >
                  Empty
                </p>
              ) : null}
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}

/** True when `relPath` is present in `tree` (the open file still exists). Re-exported for the
 * container's convenience. */
export function isInTree(tree: TreeNode, relPath: string): boolean {
  return findNode(tree, relPath) !== null
}
