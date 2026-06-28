# Bug: keyboard shortcuts dead when a dedicated viewer (image/PDF) is open

ID: `viewer-keyboard-shortcut-nonmonaco-focus-v1`
Skill: bugfix → Implementation defect (route: `developer`)
Status: In progress (delegated to developer)
Reported: 2026-06-28

## Symptom (user)

In the terminal/file-explorer split: when a file opens in the EDITOR (Monaco), keyboard shortcuts
work. When it opens in a DEDICATED viewer (image, PDF, …), the shortcuts are not detected.

## Root cause — CONFIRMED (orchestrator)

The focus-aware shortcut routing (`terminal-focus-aware-close-tab-v1` / `-tab-nav-v1`) keys off the
viewer's focus-within: `FileViewer` reports `onViewerFocusChange(true/false)` from `onFocus`/`onBlur`
(focusin/focusout bubbling) on the body wrapper, and the Terminal panel routes `Ctrl/Cmd+W` (close
file tab) + `Cmd+Opt+Arrow` (file-tab nav) to the file tabs ONLY while the viewer holds focus
(`FileViewer.tsx:262-289`, `FileExplorer.tsx:27-62`).

The populated body wrapper (`FileViewer.tsx:285`) has NO `tabIndex` — only the EMPTY placeholder
(`:281`) does. Focus can therefore enter the viewer subtree ONLY through a focusable CHILD:
- Monaco: its internal `<textarea>` IS focusable → click focuses it → focusin bubbles to the wrapper
  → `onViewerFocusChange(true)` → shortcuts route. ✓
- Dedicated viewers — `PdfView.tsx`, `DocxView.tsx`, `SheetView.tsx`, and the inline image — have NO
  `tabIndex` and NO focusable element (verified: zero `tabIndex`/`.focus(`/`onFocus` in them). So
  clicking the image/PDF never moves DOM focus into the viewer subtree → `onViewerFocusChange` stays
  false → the focus-aware shortcuts never route to the file tabs. ✗

So the defect is NOT the shortcut handlers — it's that a non-Monaco viewer body is unfocusable, so
the focus-within contract the routing depends on is never satisfied.

## Fix (developer) — implementation, renderer/DOM focus layer

Make the viewer body focusable for ALL viewer kinds so the focus-within contract holds regardless of
the active renderer:
- Give the populated body wrapper (`FileViewer.tsx:285`) `tabIndex={-1}` (it already keeps
  `outline-none`, like the empty placeholder), and FOCUS it when a non-editor viewer becomes active
  / on click within the body — so a click on an image/PDF establishes focus-within. Monaco must keep
  focusing its own textarea (don't steal focus from the editor). Prefer focusing the wrapper only
  when the active viewer kind is NOT the editor, OR make the wrapper focus a no-op-safe fallback that
  Monaco's own focus supersedes.
- Confirm the `onFocus`/`onBlur` focus-within logic + `relatedTarget` containment still behaves (no
  flap) once the wrapper itself is a focus target.
- Keep it minimal: do NOT rework the shortcut handlers — they are correct; only the focus source is
  missing.

## Regression test (jsdom — the layer that reproduces it)

`MonacoFocusNav.dom.test.tsx` already guards the Monaco case. Add the parallel guard for a DEDICATED
viewer: render `FileViewer` with a PDF (or image) `ViewerState` + ≥1 open file, simulate the
activate/click that should focus the body, and assert `onViewerFocusChange(true)` fires (and the
body wrapper holds focus) — so `Ctrl/Cmd+W` / `Cmd+Opt+Arrow` would route to the file tab. Confirm
RED before the fix (no focusable target → no focus-within), GREEN after. Update
`docs/TEST-SCENARIOS.md`.

## Verification

`npm run typecheck` + `npm test` + `npm run test:dom` green incl. the new dedicated-viewer focus
test; exercise in `npm run dev` — open a PDF/image, click it, confirm `Cmd+W` closes the file tab and
`Cmd+Opt+Arrow` cycles file tabs (matching the Monaco behavior).
