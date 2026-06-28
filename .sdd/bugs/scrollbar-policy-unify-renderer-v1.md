# Bug: Scroll policy still inconsistent — two scrollbar renderers coexist

ID: `scrollbar-policy-unify-renderer-v1`
Status: In progress
Skill: bugfix
Reported: 2026-06-28
Supersedes-context: `scrollbar-design-inconsistency-v1` (that pass added the CSS utility everywhere but did NOT remove the competing Radix renderer — this is the residual).

## Symptom (user)

"스크롤 정책 여전히 뒤죽박죽. 각 패널마다 디자인도 다르고, 어디는 보이고 어디는 안보이고, slack gen ui에서는 여전히 visible/invisible 동작 통일 안돼있음." Scrollbars look different per panel; visibility is inconsistent; Slack generative UI still shows/hides inconsistently.

## Root cause

TWO different scrollbar renderers are live at once, painting visibly different bars:
1. **Radix `ScrollArea`** (`components/ui/scroll-area.tsx`, JS overlay / custom thumb) — used in
   `calendar/googleCalendarCatalog/components.tsx`, `jira/JiraPanel.tsx`,
   `fileExplorer/FileTree.tsx`, `confluence/confluenceCatalog/CommentsSection.tsx`,
   `confluence/ConfluencePanel.tsx`, `slack/SlackPanel.tsx`.
2. **CSS `@utility scrollbar-hover-only`** (`index.css`, webkit `::-webkit-scrollbar` classic thumb)
   — used in ~16 plain `overflow-auto` regions.
Some panels (Jira, Confluence, Slack) use BOTH → inconsistent even within one panel. Plus an
`overflow-auto` (both axes, 10) vs `overflow-y-auto` (4) split. The earlier
`scrollbar-design-inconsistency-v1` pass added the CSS utility everywhere but never reconciled the
Radix renderer, so the two-renderer split remained → the persistent "각 패널마다 다르다".

## Decision (user)

**Visibility policy = hover-reveal (current `scrollbar-hover-only`): hidden at rest, revealed on
that region's hover.** RENDERER must be unified so EVERY scroll region behaves/looks identical —
remove the Radix-vs-CSS split.

## Fix (designer → developer; main session visually verifies)

ONE visual policy everywhere: thin (8px), transparent-at-rest, `muted-foreground` thumb on the
region's `:hover`, `scrollbar-gutter: stable` (no layout shift). To achieve it without two looks:
- Make the shared Radix `components/ui/scroll-area.tsx` scrollbar render that EXACT policy (so all
  6 Radix ScrollArea regions match the CSS utility), OR collapse a Radix region to a plain
  `overflow-auto scrollbar-hover-only` div where that is trivial and safe. Outcome must be: every
  scroll region is visually identical hover-reveal.
- Normalize the `overflow-auto` vs `overflow-y-auto` choice where it causes a visible horizontal
  bar difference.

## HARD CONSTRAINT — Slack per-list scroll (locked, recurring regression)

`feedback-slack-per-list-scroll`: Slack generative message lists MUST stay side-by-side, EACH list
its own independent `min-h-0 flex-1 overflow-y-auto` scroll — NEVER a unified outer scroll. This
fix is VISUAL ONLY; do NOT change `SLACK_LAYOUT_FILL_CLASS` / `SLACK_LIST_SCROLL_CLASS` structure
or the `slackCatalog/layout.tsx` flex-row split. Re-verify the 2+ message-list split after.

## Regression test

Visual (Playwright harness) is the layer that actually catches this — a node class-string check is
NECESSARY but NOT SUFFICIENT (the whole reason prior passes "fixed" it on paper but not on screen).
Add/extend a visual scene comparing 2+ scroll regions (one ex-Radix, one CSS) so their scrollbar
geometry/visibility match. Node-unit for any shared class token. Update `docs/TEST-SCENARIOS.md`.

## Resolution (2026-06-28)

Root fix in the ONE shared `components/ui/scroll-area.tsx` `ScrollBar`: thumb `bg-border` (solid,
10px) → `bg-muted-foreground/45 hover:bg-muted-foreground/70`, bar `w-2.5`→`w-2` (8px), dropped the
border. Radix `type="hover"` already hides at rest, so all 6 Radix ScrollArea regions now reveal
the SAME 8px muted thumb on hover as the CSS `scrollbar-hover-only` regions. One edit, every Radix
region matched.

**VISUALLY VERIFIED** (the step prior passes skipped) via the `scroll-policy` harness scene
(`tests/visual/test-app/scenes/ScrollPolicyScene.tsx`, Radix vs CSS side by side) + computed-style
probe: on hover the Radix bar = **8px**, thumb = `oklab(…/0.45)` = `muted-foreground/45` — exactly
the CSS hover color. Both hidden at rest. typecheck clean, unit 2573, dom 26 green. Slack
`SLACK_LIST_SCROLL_CLASS` per-list structure untouched (lock preserved).

**Content-width gutter ALSO unified (user: "완전 통일 추진"):** rather than the risky CSS→Radix
scroller conversion (would break the Cosmos auto-scroll `scrollRef` + Slack pagination/scroll-to-
latest hooks that attach to the outer `overflow` div), the Radix viewport now RESERVES the same
right inset the CSS `scrollbar-gutter` regions reserve — `SCROLL_AREA_VIEWPORT_GUTTER = 'pr-2'`
(8px) in `scroll-area.classes.ts`. Verified in the harness: Radix vs CSS content right-inset are
BOTH 20px (`match: true`). No scroller touched, Slack structure untouched.

Status: FULLY unified (bar look + hover visibility + content width), visually + computed-style
verified. Tuned `pr-2` to the macOS/Chromium CSS gutter (this is a macOS Electron app).

## Verification

`npm run typecheck`, `npm test`, `npm run test:dom` green; computed-style browser probe confirms
Radix == CSS on hover; Slack 2-list split structure intact.
