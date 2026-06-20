# Bug Report: settings-visual (v1)

- **Status:** Fixed <!-- Open | Investigating | Routed | Fixed | Escalated-to-sdd -->
- **Reported:** 2026-06-21
- **Severity:** degraded (3 cosmetic/affordance defects in the #93 Settings redesign)
- **Regression:** yes — all three introduced by the just-landed (uncommitted) #93
  Settings redesign (`SettingsDialog.tsx`, `App.tsx` rail, `switch.tsx`). The #94 bugfix
  already moved file-tab/divider accents off `--primary` blue onto `--brand-*`; these three
  finish that direction for the Settings surface.

## Grounding (queries actually run)

- `memory_recall` "cosmos brand color primary blue brand-pink design tokens active selected"
  → empty (no prior memory persisted; relied on prompt + on-disk tokens).
- `memory_smart_search` "Settings dialog redesign status dot rail brand accent #94" → empty.
- `codegraph_explore` "SettingsDialog two-pane vertical tabs status dot rail railVisibility
  switch theme tokens" → returned verbatim `SettingsDialog.tsx` (StatusDot §903, SettingsTab
  §921, IntegrationTab/ConnectionBlock §956–1049, useLiveStatuses §869), `PanelTabStrip.tsx`,
  `useGenerativePanelTabs.ts`. Takeaway: `StatusDot` connected color = `bg-primary`; dot is
  rendered only when `enabled[id]` is true.
- Read `src/renderer/index.css` (all tokens) → `--primary`/`--ring` = `#4a9eff` (blue) in both
  `:root` and `.dark`; `--brand-pink #f9a8d4` / `--brand-purple #d8b4fe` / `--brand-foreground
  #2e1065` already defined with `bg-brand-*` mappings.
- Read `src/renderer/components/ui/switch.tsx` → on-track = `bg-primary`, focus = `ring-ring`.
- Read `src/renderer/components/ui/dialog.tsx` → `DialogContent` is a `grid` with no height;
  height is content-driven.
- Read `src/renderer/App.tsx` (rail, §188–264) → active rail indicator bar + pill use
  `before:bg-primary` and `bg-secondary`; the rail has NO per-surface connection dot.
- Grep `src/preload/index.ts` + `src/shared/googleCalendar.ts` → `window.cosmos.googleCalendar`
  has `getStatus()` + `onStatusChanged()` and returns `state: 'connected'`. GCal status IS
  wired into `useLiveStatuses`; the dot is NOT broken by missing data.

## Symptom

Three user-reported defects on the redesigned Settings dialog:

1. "google calendar만 연동해서 파란점 안보임." — With only Google Calendar connected, the
   connected (blue) status dot does not appear in the Settings side-nav.
2. "전체적으로 활성화 색으로 파란색을 많이 쓰는데 primary 색인가? 그렇다면 cosmos 로고색으로
   바꿔." — The project-wide blue active/selected color should become the cosmos brand
   (pink→purple) color.
3. "setting에서 어떤 tab이냐에 따라서 계속 modal 크기가 바뀜. modal 크기 통일해줘." — The
   Settings modal changes size depending on which integration tab is active.

## Expected vs Actual

- **Expected:** (1) A connected integration always shows its connected dot. (2) Active/selected
  affordances read as the cosmos brand color, consistent with #94. (3) The Settings dialog is a
  fixed size; switching tabs never reflows it.
- **Actual:** (1) The dot only renders when the integration is *also* enabled ("Show in
  sidebar"); a connected-but-not-shown GCal has no dot. (2) Active rail bar/pill, active
  Settings tab, the Switch on-track, the connecting spinner, and the connected dot are all
  `--primary` blue `#4a9eff`. (3) Each `TabsContent` is sized by its own content under a
  shared `max-h-[60vh]`, so a short tab (General) is shorter than a tall one (Jira with the
  shared-Atlassian banner + credentials), and the modal height jumps per tab.

## Reproduction

1. Open Settings. Connect Google Calendar but leave its "Show in sidebar" toggle OFF.
   → Side-nav Google Calendar row shows no status dot (defect #1).
2. Observe the active rail indicator, the active Settings tab pill, and the Switch on-track —
   all blue, not brand (defect #2).
3. Switch between the General tab and the Jira tab → the modal height changes (defect #3).

## Scope & Severity

One surface (Settings dialog) plus the global active-color token. #2 has the widest blast
radius — `--primary`/`--ring` is consumed by Buttons, focus rings, the Switch, the rail
indicator, the Settings tabs, the connecting spinner, the connected dot, and `prose` links —
so it is scoped deliberately below. No crash; degraded affordance/visual-consistency.

## Scope gate (Step 1.5)

- **Decision:** continue bug cycle (do NOT escalate to `sdd`).
- **Reason:** Three localized defects — two are pure design-token/class edits I make directly
  in `index.css` + `switch.tsx`; the third (#1) is a one-line gating change + one class tweak
  in `App.tsx`/`SettingsDialog.tsx`. No new IPC contract, no new architecture.

## Classification & Routing (Step 2)

- **Class:** Design defect (all three).
- **Routed to:** designer (tokens/primitives/classes — done directly) + developer (the #1
  enable-vs-connected gating logic in `SettingsDialog.tsx`, and applying the prescribed class
  edits the designer cannot place without touching feature JSX).
- **Reason:** #2 and #3 are token/sizing decisions the design system owns; #1's visual half is
  the dot's size/color (designer) and its wiring half (when to render) is renderer logic
  (developer).

## Root Cause (Step 3)

### Defect #1 — connected dot invisible for a lone Google Calendar connection

The GCal status is fully wired: `window.cosmos.googleCalendar.getStatus()`/`onStatusChanged()`
exist (`src/preload/index.ts:297,317`) and return `state: 'connected'`
(`src/shared/googleCalendar.ts:42`), and `useLiveStatuses` seeds + subscribes all four
integrations including `'google-calendar'` (`SettingsDialog.tsx:885,894–895`). So the data
reaches `liveStatus['google-calendar'].state === 'connected'`.

The dot is **not** missing because of data or color — it is **gated behind `enabled`, not
`connected`**:

- **Origin:** `src/renderer/SettingsDialog.tsx:321–325` (and the same pattern for the other
  three tabs at `:300, :307, :314`):
  ```tsx
  dot={ enabled['google-calendar'] ? <StatusDot state={liveStatus['google-calendar'].state} /> : null }
  ```
- **Why:** "Connected" and "Shown in sidebar" are independent (the design explicitly allows
  enabling without connecting, and therefore connecting without enabling). When the user
  connects Google Calendar but leaves "Show in sidebar" OFF, `enabled['google-calendar']` is
  `false`, so the ternary yields `null` and **no dot renders at all** — the connection is
  invisible. A secondary, smaller factor: even when shown, the connected dot is only `size-1.5`
  (6px) `bg-primary`, which is small; the visual fix below enlarges it. The primary cause is
  the gating, not the color/contrast (blue `#4a9eff` on the `bg-secondary #3a3a3c` active row,
  or on `bg-popover/40`, is above contrast threshold).

### Defect #2 — pervasive blue active color

- **Origin:** `src/renderer/index.css:158,170` (`:root`) and `:223,235` (`.dark`):
  `--primary: #4a9eff; --ring: #4a9eff` (`.dark --ring` is actually `#4a4a4c`, see below).
- **Why:** Every "active/selected/connected" affordance resolves to `--primary` (blue):
  the rail active indicator bar + the connecting spinner (`App.tsx:216` `before:bg-primary`,
  `SettingsDialog.tsx:906` `text-primary`), the Switch on-track (`switch.tsx:21`
  `data-[state=checked]:bg-primary`), the connected dot (`SettingsDialog.tsx:913`
  `bg-primary`), and `prose` links (`index.css:101`). `--primary` is ALSO the semantic color
  for actionable primary Buttons (Connect, Save). So a blanket retheme of `--primary` would
  brand-tint primary buttons too — see scope decision below.

### Defect #3 — modal resizes per tab

- **Origin:** `src/renderer/SettingsDialog.tsx:273` (`DialogContent` has width `max-w-[640px]`
  but **no height**) and `:333,340,379,415,451` (each `TabsContent` is
  `max-h-[60vh] overflow-y-auto`).
- **Why:** `DialogContent` (dialog.tsx:62) is a `grid` with no fixed height; the right pane's
  height is whatever the active `TabsContent` measures, capped at `60vh`. Short tabs (General)
  are shorter than tall ones (Jira: shared-Atlassian banner + Client ID + Secret), so the modal
  grows/shrinks as the user switches tabs — the modal has no stable height to scroll *within*.

## Fix (Step 4)

### Defect #2 — scope decision (the critical one)

**Recommended: option (b), the SCOPED fix — retarget the active/selected/connected
*affordances* to `--brand-*`, and leave `--primary` as the semantic actionable color, but
swap `--primary`'s value from blue to the brand purple so any remaining primary surface also
reads brand.**

Rationale (why not a blunt wholesale retheme):
- A wholesale `--primary: <brand pink>` would tint Connect/Save **buttons** the same pastel
  pink/purple as the passive "selected" chrome — collapsing the affordance distinction between
  "this is the actionable button" and "this row is selected", and the pastel `--brand-pink`
  `#f9a8d4` as a *button fill* with `--primary-foreground` (`.dark #0b1622`) is a low-contrast,
  off-brand button. So we do not point `--primary` at the pastel.
- But the user's intent is "active color = logo color." The cleanest reading that satisfies
  both: the **brand identity is the pink→purple gradient**, so the single *solid* brand accent
  for active state is the **purple** end (`--brand-purple #d8b4fe`), which is what #94 already
  used for file-tab/divider accents. We introduce one solid token and point the
  active/selected/connected affordances at it; the gradient stays reserved for the logo mark.

**Token edits — `src/renderer/index.css` (done directly by designer):**

1. Add a single solid active-accent token in the `@theme inline` block (next to the brand
   tokens, ~line 84), so it is consumable as `bg-brand-accent` / `text-brand-accent` /
   `ring-brand-accent` / `before:bg-brand-accent`:
   ```css
   --color-brand-accent: var(--brand-accent);
   --color-brand-accent-foreground: var(--brand-accent-foreground);
   ```
2. Define its value in `:root` (light fallback, ~after line 212) AND `.dark` (~after line 281),
   reusing the existing brand purple (NO new hex):
   ```css
   /* :root and .dark — same solid brand accent, the purple end of the brand gradient,
      used for active/selected/connected affordances (settings-visual-v1). */
   --brand-accent: #d8b4fe;            /* == --brand-purple */
   --brand-accent-foreground: #2e1065; /* == --brand-foreground */
   ```
   (Both modes share the value, exactly like the existing `--brand-*` block.)
3. Fix `--ring` so focus rings are brand, not the stray neutral. NOTE: in `.dark`, `--ring` is
   currently `#4a4a4c` (a neutral gray, line 235) — focus rings on dark are nearly invisible.
   Point BOTH `:root` and `.dark` `--ring` at the brand accent:
   ```css
   --ring: #d8b4fe; /* was #4a9eff (:root) / #4a4a4c (.dark) */
   ```
4. **Leave `--primary` for now as the semantic actionable color**, but retire the blue: set
   `--primary` to the brand purple in both blocks so any primary Button/link also reads brand
   instead of the old blue, while keeping a foreground that stays legible:
   ```css
   --primary: #d8b4fe;            /* was #4a9eff — brand purple, the active color */
   --primary-foreground: #2e1065; /* :root was #ffffff, .dark was #0b1622 — dark violet on pastel */
   ```
   This makes `bg-primary` text/fills read as dark-violet-on-pastel (contrast ~8:1, passes),
   matching the brand. The connected dot / Switch on-track / rail bar / spinner all consume
   `--primary` and therefore turn brand with no further class edits — but for clarity and to
   decouple the *affordance* accent from the *button* color long-term, the developer should
   also retarget the explicit affordance classes to `brand-accent` (below). If you prefer the
   absolute-minimum change, steps 1–4 alone already turn every blue affordance brand; the
   class retargets in the next list are the cleaner, decoupled form.

**Class edits to retarget affordances explicitly to `brand-accent` (developer — feature JSX
the designer must not hand-edit blind):**

- `src/renderer/App.tsx:216` rail active bar: `before:bg-primary` → `before:bg-brand-accent`.
- `src/renderer/SettingsDialog.tsx:906` connecting spinner: `text-primary` → `text-brand-accent`.
- `src/renderer/SettingsDialog.tsx:913` connected dot: `bg-primary` → `bg-brand-accent`
  (also see #1 size bump below).
- `src/renderer/components/ui/switch.tsx:21` on-track:
  `data-[state=checked]:bg-primary` → `data-[state=checked]:bg-brand-accent`
  (designer owns this primitive — done directly).

If the developer applies the class retargets above, `--primary` may stay any value; but since
the user wants NO blue anywhere, steps 1–4 (retiring `#4a9eff`) are still required. Net: zero
`#4a9eff` references remain.

### Defect #1 — connected dot

- **Wiring (developer), `SettingsDialog.tsx:300,307,314,321–325`:** render the dot based on
  **connection, not enablement** — show it whenever the integration is connected (or
  connecting / reconnect-needed), regardless of `enabled`. Replace each
  `dot={ enabled[id] ? <StatusDot .../> : null }` with a render that shows the dot when
  `liveStatus[id].state !== 'not_connected'` (so a connected-but-not-shown integration still
  signals connected), e.g.:
  ```tsx
  dot={ liveStatus[id].state !== 'not_connected' ? <StatusDot state={liveStatus[id].state} /> : null }
  ```
  Keep `dimmed={!enabled[id]}` as-is (label stays dimmed when not shown in sidebar — that is a
  separate, correct signal). This makes the lone-GCal case show its connected dot.
- **Visual (designer), `StatusDot` `SettingsDialog.tsx:912–916`:** bump the dot from
  `size-1.5` (6px) to `size-2` (8px) for legibility, and use the brand accent for connected:
  ```tsx
  'size-2 rounded-full',
  state === 'connected' && 'bg-brand-accent',
  state === 'reconnect_needed' && 'bg-destructive',
  state === 'not_connected' && 'border border-muted-foreground bg-transparent'
  ```
  Connected `#d8b4fe` on the active row `bg-secondary #3a3a3c` is ~7:1 — clearly visible. The
  `connecting` spinner stays `text-brand-accent` (per #2).

### Defect #3 — uniform modal size

Give the dialog a fixed height and scroll the content *within* it, so tab switches never
reflow the modal. Designer specifies; developer applies (feature JSX).

- `src/renderer/SettingsDialog.tsx:273` `DialogContent`: add a fixed height and make it a
  vertical flex column with hidden overflow so the two-pane body (not the dialog) scrolls.
  Change `className="max-w-[640px] gap-0 bg-popover p-0"` to:
  ```tsx
  className="flex h-[560px] max-w-[640px] flex-col gap-0 overflow-hidden bg-popover p-0"
  ```
  (`h-[560px]` is a fixed height that comfortably holds the tallest tab — Jira — within the
  `640×?` modal; it is below the old `60vh` cap on typical windows so the modal stays fully
  on-screen. The `flex flex-col` lets the header stay fixed and the body take the rest.)
- The `<Tabs orientation="vertical" className="!gap-0 items-stretch">` wrapper
  (`SettingsDialog.tsx:285–289`): add `min-h-0 flex-1 overflow-hidden` so it fills the
  remaining height under the header and clips internally:
  ```tsx
  className="!gap-0 items-stretch min-h-0 flex-1 overflow-hidden"
  ```
- The right-pane container `<div className="flex-1 overflow-hidden">`
  (`SettingsDialog.tsx:330`): keep as is (already `flex-1 overflow-hidden`).
- Each `TabsContent` (`:333,340,379,415,451`): replace `max-h-[60vh] overflow-y-auto` with
  `h-full overflow-y-auto` so EVERY tab's content fills the same fixed-height pane and scrolls
  internally — the pane never changes height by tab:
  ```tsx
  className="h-full overflow-y-auto px-6 py-5 outline-none"
  ```
  The side-nav `TabsList` (`:290–294`, `w-44`) is already fixed-width and short; it will be
  shorter than the body, which is fine (the body owns the scroll).

Result: the modal is a stable `640×560`; the header is fixed; the active tab's content scrolls
inside the right pane; switching tabs swaps content with zero modal reflow.

- **Files changed (designer, directly):**
  - `src/renderer/index.css` — add `--brand-accent`/`--brand-accent-foreground` tokens
    (`@theme inline` + `:root` + `.dark`), retire `--primary`/`--ring` blue `#4a9eff` to brand
    purple `#d8b4fe`.
  - `src/renderer/components/ui/switch.tsx` — on-track `bg-primary` → `bg-brand-accent`.
- **Files to change (developer, feature JSX):**
  - `src/renderer/SettingsDialog.tsx` — #1 dot gating (connected-not-enabled), #1 dot
    `size-2` + `bg-brand-accent`, #2 spinner `text-brand-accent`, #3 fixed `h-[560px]` modal +
    `h-full` TabsContent.
  - `src/renderer/App.tsx:216` — rail active bar `before:bg-primary` → `before:bg-brand-accent`.

## Regression Test (Step 5)

- **Test (developer):** extend `railVisibility.test.ts` is the wrong layer (pure logic, no
  dots). Add a renderer/unit assertion in a new `SettingsDialog` test (or a small pure helper
  test) that, given `enabled['google-calendar'] === false` and
  `liveStatus['google-calendar'].state === 'connected'`, the dot-render predicate returns
  truthy (the dot is shown). If the dot-show rule is extracted to a pure helper
  `shouldShowStatusDot(state) => state !== 'not_connected'`, unit-test it directly.
- **Asserts:** a connected-but-not-enabled integration shows its status dot; a not-connected
  one does not.
- **Fails-without-fix confirmed:** yes — under the current `enabled[id] ? … : null` gate the
  predicate is false for connected-not-enabled, so the assertion fails before the fix.
- #2/#3 are visual; verify by exercising the dialog (no `#4a9eff` remains in computed styles;
  modal height constant across tabs).

## Verification (Step 6)

- [x] `npm run typecheck` green for all touched files (`settingsStatusDot.ts/.test.ts`,
      `SettingsDialog.tsx`, `App.tsx` — zero errors). NOTE: 3 pre-existing TS6133 unused-import
      errors in `promptComposerLogic.test.ts` come from concurrent #96-adjacent in-flight work
      (3 uncommitted insertions), NOT this fix.
- [x] `npm test` green — full suite 1871 passed / 0 failed, incl. the new
      `settingsStatusDot.test.ts` dot-predicate test (5 cases).
- [ ] Step 1 repro re-run — connect only Google Calendar (sidebar OFF): connected dot shows
      — NEEDS LIVE `npm run dev` (visual). Logic verified by unit test
      (`shouldShowStatusDot('connected') === true`); dot gating now keyed on `liveStatus[id].state`.
- [ ] No `#4a9eff` remains; rail bar, active tab, Switch, dot, focus ring all brand purple
      — NEEDS LIVE `npm run dev` (visual). Tokens/classes retargeted to `brand-accent`. One
      stale `#4a9eff` reference remains only in an `index.css` COMMENT (the Google-Calendar
      event-chips block, ~line 266) — cosmetic doc note, not a live value; out of dev hand-off
      scope (designer owns tokens). Flagged for designer at wrap-up.
- [ ] Switch General ↔ Jira ↔ Slack tabs — modal stays `640×560`, content scrolls internally
      — NEEDS LIVE `npm run dev` (visual). Layout classes applied: `DialogContent`
      `flex h-[560px] … flex-col overflow-hidden`, Tabs `min-h-0 flex-1 overflow-hidden`, all
      five `TabsContent` `h-full overflow-y-auto`.
- [ ] Contrast: brand purple `#d8b4fe` dot/bar on `bg-secondary`/`bg-popover` ≥ 3:1; primary
      button text `#2e1065` on `#d8b4fe` ≥ 4.5:1 — NEEDS LIVE confirmation (visual).
- [ ] No regressions in adjacent brand usage (#94 file-tab/divider accents unchanged) — NEEDS
      LIVE confirmation. No #94 files touched by this hand-off.

## Wrap-up (Step 7)

- **bug memory saved:** <on fix completion>
- **Docs updated:** none required (token addition is self-documenting in `index.css`); if the
  `--brand-accent` token becomes the standing "active affordance" token, note it in
  DEVELOPMENT.md styling section at wrap-up.
- **wrap-up run:** <pending>
