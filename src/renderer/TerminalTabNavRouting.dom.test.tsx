/**
 * DOM test for focus-aware Cmd+Opt+Arrow tab-navigation routing
 * (terminal-focus-aware-tab-nav-v1, jsdom env, vitest.dom.config.ts).
 *
 * The bug: when the FILE EDITOR/viewer pane holds focus, Cmd+Opt+Arrow (delivered as the
 * `tab:next`/`tab:prev` shortcut command) moved the TERMINAL tabs instead of the FILE tabs.
 * The pure decision logic (`useTabShortcuts` neighbour math, `resolveTabNavTarget`) passes in
 * isolation; the defect was the WIRING — the terminal handler ran regardless of which pane had
 * focus. This test renders the REAL wiring (the same `useTabShortcuts` + `resolveTabNavTarget`
 * the Terminal panel uses, focus tracked exactly like `FileViewer.onViewerFocusChange`), puts
 * focus in the editor pane, dispatches the nav command, and asserts the FILE tab moved and the
 * TERMINAL tab did NOT — and the inverse when the terminal pane is focused.
 *
 * It uses lightweight strips (not Monaco/the real FileViewer) so the test isolates the
 * focus→routing wiring without the editor/IPC weight; the focus-within tracking and the
 * routing/predicate/cycle code under test are the REAL modules.
 *
 * SCOPE / FALSE-CONFIDENCE WARNING (terminal-tab-nav-monaco-focus-v1): this harness fires
 * `fireEvent.focus` on a PLAIN div whose `focusin` DOES bubble, so it validates only the
 * routing/predicate once `viewerFocused` is true. It does NOT — and CANNOT — reproduce the real
 * defect where the REAL Monaco editor mounts its keyboard-input <textarea> on `document.body`
 * (no `overflowWidgetsDomNode`), OUTSIDE the FileViewer subtree, so the editor's focus never
 * bubbles to the wrapper's `onFocus` and `viewerFocused` wrongly stayed false. That class of bug
 * is covered by `fileExplorer/MonacoFocusNav.dom.test.tsx` (real `MonacoText`→`onViewerFocusChange`
 * via Monaco's own `onDidFocusEditorText`), with the full real-editor keystroke deferred to e2e.
 * Do NOT treat a green run here as proof the Monaco-focused shortcut routes correctly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useRef, useState } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { cycleActiveId } from './panelTabs'
import { resolveTabNavTarget } from './closeTabRouting'
import { useTabShortcuts } from './useTabShortcuts'
import type { ShortcutTriggerPayload } from '../shared/ipc'

// ---------------------------------------------------------------------------
// window.cosmos stub — mimics the Electron preload shortcuts IPC
// ---------------------------------------------------------------------------

type TriggerHandler = (payload: ShortcutTriggerPayload) => void
let _triggerHandler: TriggerHandler | null = null

const cosmosMock = {
  shortcuts: {
    onTrigger: vi.fn((handler: TriggerHandler) => {
      _triggerHandler = handler
      return () => {
        _triggerHandler = null
      }
    })
  }
}

function fireTrigger(payload: ShortcutTriggerPayload): void {
  if (!_triggerHandler) throw new Error('No trigger handler registered — harness not mounted?')
  // Wrap in act() so the state updates the handler triggers (setActiveRel / setActiveTermId) flush
  // before we assert — fireEvent auto-wraps, but this manual IPC dispatch does not.
  act(() => {
    _triggerHandler?.(payload)
  })
}

/** True iff the `role="tab"` button at `testId` is the selected tab. */
function isSelected(testId: string): boolean {
  return screen.getByTestId(testId).getAttribute('aria-selected') === 'true'
}

beforeEach(() => {
  _triggerHandler = null
  cosmosMock.shortcuts.onTrigger.mockClear()
  ;(window as unknown as { cosmos: typeof cosmosMock }).cosmos = cosmosMock
})

afterEach(() => {
  _triggerHandler = null
})

// ---------------------------------------------------------------------------
// Harness — mirrors the TerminalPanel wiring (the code path the bug lives in)
// ---------------------------------------------------------------------------

const TERMS = [
  { id: 't1', label: 'Terminal 1' },
  { id: 't2', label: 'Terminal 2' }
]
const FILES = [
  { relPath: 'a.ts', name: 'a.ts' },
  { relPath: 'b.ts', name: 'b.ts' }
]

function Harness(): React.JSX.Element {
  // Terminal panel tab state.
  const [activeTermId, setActiveTermId] = useState('t1')
  // File-viewer open-file tab state.
  const [activeRel, setActiveRel] = useState('a.ts')
  // Lifted viewer focus-within (terminal-focus-aware-*): set exactly like FileViewer's onFocus/onBlur.
  const [viewerFocused, setViewerFocused] = useState(false)

  // Held in a ref like TerminalPanel.viewerStateByPaneRef so the shortcut reads the latest at call time.
  const viewerStateRef = useRef({
    viewerFocused,
    openFileCount: FILES.length,
    navFileTab: (delta: number) => {
      const next = cycleActiveId(
        FILES.map((f) => ({ id: f.relPath })),
        activeRel,
        delta
      )
      if (next) setActiveRel(next)
    }
  })
  viewerStateRef.current = {
    viewerFocused,
    openFileCount: FILES.length,
    navFileTab: (delta: number) => {
      const next = cycleActiveId(
        FILES.map((f) => ({ id: f.relPath })),
        activeRel,
        delta
      )
      if (next) setActiveRel(next)
    }
  }

  useTabShortcuts({
    active: true,
    tabs: TERMS,
    activeTabId: activeTermId,
    onActivate: setActiveTermId,
    onNewTab: vi.fn(),
    onCloseTab: vi.fn(),
    resolveNav: () =>
      resolveTabNavTarget({
        viewerFocused: viewerStateRef.current.viewerFocused,
        openFileCount: viewerStateRef.current.openFileCount
      }),
    onNavFileTab: (delta) => viewerStateRef.current.navFileTab(delta)
  })

  return (
    <div>
      {/* The FILE viewer/editor pane — focus-within tracked exactly like FileViewer. */}
      <div
        data-testid="editor-pane"
        tabIndex={-1}
        onFocus={() => setViewerFocused(true)}
        onBlur={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
          setViewerFocused(false)
        }}
      >
        <div role="tablist" aria-label="Open files">
          {FILES.map((f) => (
            <button
              key={f.relPath}
              role="tab"
              aria-selected={f.relPath === activeRel}
              data-testid={`file-tab-${f.relPath}`}
            >
              {f.name}
            </button>
          ))}
        </div>
      </div>

      {/* The TERMINAL pane + its tab strip. */}
      <div data-testid="terminal-pane" tabIndex={-1}>
        <div role="tablist" aria-label="Terminal tabs">
          {TERMS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.id === activeTermId}
              data-testid={`term-tab-${t.id}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

describe('focus-aware Cmd+Opt+Arrow tab-nav routing (terminal-focus-aware-tab-nav-v1)', () => {
  it('moves the FILE tabs (not the terminal tabs) when the editor pane holds focus', () => {
    render(<Harness />)

    // Focus the editor/viewer pane (Cmd+Opt+Arrow with editor focused must target FILE tabs).
    fireEvent.focus(screen.getByTestId('editor-pane'))

    // Dispatch the nav shortcut command (Cmd+Opt+Right → tab:next).
    fireTrigger({ command: 'tab:next' })

    // FILE tab advanced a → b…
    expect(isSelected('file-tab-b.ts')).toBe(true)
    expect(isSelected('file-tab-a.ts')).toBe(false)
    // …and the TERMINAL tab did NOT move (still t1) — the routing bug would have moved it.
    expect(isSelected('term-tab-t1')).toBe(true)
    expect(isSelected('term-tab-t2')).toBe(false)
  })

  it('moves the TERMINAL tabs (not the file tabs) when the terminal pane holds focus', () => {
    render(<Harness />)

    // Terminal focused (the editor pane was never focused → viewerFocused stays false).
    fireEvent.focus(screen.getByTestId('terminal-pane'))

    fireTrigger({ command: 'tab:next' })

    // TERMINAL tab advanced t1 → t2…
    expect(isSelected('term-tab-t2')).toBe(true)
    expect(isSelected('term-tab-t1')).toBe(false)
    // …and the FILE tab did NOT move (still a.ts).
    expect(isSelected('file-tab-a.ts')).toBe(true)
    expect(isSelected('file-tab-b.ts')).toBe(false)
  })

  it('routes file→terminal again after focus leaves the editor pane (tab:prev wraps)', () => {
    render(<Harness />)

    // Focus editor, advance file tab to b.
    fireEvent.focus(screen.getByTestId('editor-pane'))
    fireTrigger({ command: 'tab:next' })
    expect(isSelected('file-tab-b.ts')).toBe(true)

    // Blur the editor (focus leaves to the terminal pane) → routing reverts to terminal tabs.
    fireEvent.blur(screen.getByTestId('editor-pane'), {
      relatedTarget: screen.getByTestId('terminal-pane')
    })
    fireTrigger({ command: 'tab:next' })

    // Terminal moved; the file tab stayed on b.
    expect(isSelected('term-tab-t2')).toBe(true)
    expect(isSelected('file-tab-b.ts')).toBe(true)
  })
})
