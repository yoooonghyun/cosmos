# Bug: Scrollbar design inconsistent across the app

ID: `scrollbar-design-inconsistency-v1`
Status: In progress
Skill: bugfix
Reported: 2026-06-28

## Symptom

Scroll regions across the app render with DIFFERENT scrollbars — some use the themed
`scrollbar-hover-only` treatment (Slack generative lists), most are plain `overflow-y-auto`
divs showing the raw OS/Chromium scrollbar. Visually inconsistent; not on the design
foundation.

## Classification

Design defect → `designer`. The scroll-region visual treatment is not unified to the
DESIGN.md foundation. Logic/structure is correct; only the scrollbar appearance diverges.

## Root cause

`scrollbar-hover-only` (the canonical themed scrollbar @utility, `src/renderer/index.css`,
from bug `slack-genui-scrollbar-hover-only-v2`) is applied ONLY in `slackCatalog`. DESIGN.md
§ScrollArea names it but there is no enforced registry rule, so ~13 other scroll regions ship
the default OS scrollbar:
`calendar/GoogleCalendarPanel.tsx`, `calendar/googleCalendarCatalog/components.tsx`,
`app/SettingsDialog.tsx`, `cosmos/CosmosPanel.tsx`, `components/ui/select.tsx`,
`jira/JiraPanel.tsx`, `fileExplorer/{SheetView,DocxView,PdfView,FileViewer}.tsx`,
`confluence/ConfluencePanel.tsx`, `slack/SlackPanel.tsx`, `slack/useSlackScrollPaginate.ts`.

## Fix (designer)

Unify every scroll region onto the foundation treatment (Radix `ScrollArea` or the
`scrollbar-hover-only` @utility per DESIGN.md §ScrollArea), and add a Design Criteria Registry
rule so it stops drifting. Reconcile any per-surface specifics (file viewers with their own
internal scroll — Monaco/PDF — may not take the class; use judgment).

## HARD CONSTRAINT — do NOT regress Slack per-list scroll

`feedback-slack-per-list-scroll` (locked): Slack generative message lists MUST stay
side-by-side with EACH list its own independent `min-h-0 flex-1 overflow-y-auto` scroll —
NEVER a unified outer scroll. This is a recurring regression. This bug changes only the
scrollbar VISUAL (the shared class); it MUST NOT touch the Slack scroll STRUCTURE
(`SLACK_LAYOUT_FILL_CLASS`, `SLACK_LIST_SCROLL_CLASS`, `slackCatalog/layout.tsx` flex-row
split). After the change, re-verify the 2+ message-list case still splits + scrolls per-list.

## Regression test

Node-unit: assert each scroll-region class string carries the canonical scrollbar token
(class-string presence is node-testable). The Slack per-list structure assertions
(`SLACK_LAYOUT_FILL_CLASS`/`SLACK_LIST_SCROLL_CLASS` keep `flex-row` + per-list overflow) must
still pass. Visual layer for actual rendered scrollbar.

## Verification

`npm run typecheck`, `npm test`; re-confirm Slack 2-list split; spot-check panels in
`npm run dev`.
