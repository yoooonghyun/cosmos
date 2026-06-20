# Bug: File-viewer surface — stray blue accents + no word-wrap — v1

**Status**: Fixed
**Created**: 2026-06-20
**Board**: #94
**Surface**: terminal multi-file viewer (terminal-file-tabs-v1, #91)
**Type**: 3 small defects on a just-shipped surface — classified `developer` (in-place fix, no
new contract, renderer-only). No `sdd` escalation needed.

---

## Defects, symptoms, causes, fixes

### 1. FileTabStrip active tab is blue (off-palette; mismatches the terminal tab strip)

- **Symptom**: the active file tab carries a 2px BLUE top-accent and does not read like the
  terminal tab strip (`PanelTabStrip`) directly above it.
- **Cause**: `FileTabStrip.tsx`'s active treatment used `bg-card` + a `before:bg-primary`
  top-accent. `--primary` is `#4a9eff` (blue), and `bg-card` is the quieter in-column tone — so
  the active tab looked both blue and dimmer than `PanelTabStrip`'s active tab.
- **Fix**: replicate `PanelTabStrip`'s active treatment VERBATIM — `data-[state=active]:bg-background`
  + `font-medium` + `text-foreground` + the pink→purple BRAND-gradient top-accent
  (`before:bg-gradient-to-r before:from-brand-pink before:to-brand-purple`), dropping the blue
  `--primary`. The two strips now read identically. (The band stays `bg-card/60` — the deliberate
  one-notch-quieter in-column-chrome decision from the #91 design; only the active TAB look changed.)
- **File**: `src/renderer/fileExplorer/FileTabStrip.tsx`.

### 2. Long lines don't wrap — the viewer shows a horizontal scrollbar

- **Symptom**: a long source line runs off the right edge and the Monaco editor shows a horizontal
  scrollbar instead of wrapping.
- **Cause**: the viewer's Monaco editor was constructed with `wordWrap: 'off'`.
- **Fix**: set `wordWrap: 'on'` (soft word-wrap). The setting was pulled out of the `FileViewer`
  component into a new PURE, node-tested factory `buildViewerEditorOptions(relPath)` in
  `monacoTheme.ts` so the load-bearing value is unit-testable. Confirmed no container forces an
  `overflow-x`: the Monaco mount is `h-full min-h-0 w-full` (no overflow class); the only
  `overflow-auto` in the viewer is the IMAGE branch, not the text path. No non-Monaco `pre`/`code`
  path exists, so no `whitespace-pre-wrap break-words` was needed.
- **Files**: `src/renderer/fileExplorer/FileViewer.tsx`, `src/renderer/fileExplorer/monacoTheme.ts`.

### 3. ResizeDivider focus/drag highlight is blue

- **Symptom**: the column resize divider's centered accent line (on hover/drag) and its focus ring
  are blue — stray from the cosmos logo/brand color.
- **Cause**: the divider used `--primary` (`#4a9eff`, blue) for the hover/drag accent line and
  `ring-ring/50` (`--ring` = `#4a9eff`, also blue) for the focus ring.
- **Fix**: swap the accent line to `bg-brand-purple/40` (hover) / `bg-brand-purple/70` (drag) and
  the focus ring to `ring-brand-purple/50` — the cosmos logo's pink→purple family. No blue left.
- **File**: `src/renderer/fileExplorer/ResizeDivider.tsx`.

---

## Token facts (confirmed)

- `--primary` and `--ring` are both `#4a9eff` (blue).
- The brand/logo set is `--brand-pink` / `--brand-purple` / `--brand-foreground`
  (`index.css` ~L79-84), exposed as Tailwind `bg-brand-purple` / `from-brand-pink` /
  `to-brand-purple` via the `--color-brand-*` mappings.

## Regression coverage

- Colors are not cleanly regression-testable (CSS classes / token values), so they are verified by
  the fix being a verbatim class swap to the existing `PanelTabStrip` / brand idioms.
- The wrap fix IS pure: `buildViewerEditorOptions` is node-tested in `monacoTheme.test.ts` —
  `wordWrap === 'on'`, plus the read-only settings and the extension→language mapping.

## Verification

- `npm run typecheck` — clean for all terminal/fileExplorer files (pre-existing `googleCalendar*`
  errors are a concurrent agent's, unrelated).
- `npm test` (fileExplorer suite) — green, including the 3 new `buildViewerEditorOptions` tests.
- UI behavior (the active-tab color match, the live word-wrap, the divider highlight color) is NOT
  exercised by automated tests — manual in-app verification of the colors + wrap is still owed.
