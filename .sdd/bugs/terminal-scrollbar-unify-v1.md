# Bug: Terminal scrollbar not unified with the panel scroll policy

ID: `terminal-scrollbar-unify-v1`
Skill: bugfix
Status: In progress
Reported: 2026-06-28

## Symptom (user)

The panels' full-screen scroll uses the unified hover-reveal bar, but the Terminal's scroll does
not match — "패널의 전체화면 스크롤과, Terminal 쪽엔 스크롤 통일 안된 듯".

## Root cause

xterm renders its OWN scroll container `.xterm-viewport` (not a DOM `overflow` div the app styles),
and NOTHING styles its scrollbar (`grep '.xterm-viewport'` → 0 hits). So the terminal shows xterm's
default scrollbar while every panel region now uses the `scrollbar-hover-only` policy (8px,
transparent at rest, `muted-foreground` thumb on hover). The terminal is the one un-unified region.

## Fix

Style `.xterm-viewport` (in `TerminalPanel.css`) with the SAME hover-reveal recipe the
`scrollbar-hover-only` @utility uses: 8px track, transparent thumb at rest, `muted-foreground/45`
on the viewport's hover (`/70` on direct thumb hover), transparent track. NO forced
`scrollbar-gutter` (xterm manages the viewport's own width/col fit — reserving a gutter risks the
col计算). Visual parity with the panels; xterm fit/sizing untouched.

## Classification

Design/CSS defect → fixed inline (one CSS block, matches the existing documented policy).

## Resolution (2026-06-28)

`TerminalPanel.css`: added a `.xterm-viewport::-webkit-scrollbar*` block matching the
`scrollbar-hover-only` recipe (8px, transparent at rest, `muted-foreground/45` on hover, `/70` on
thumb hover, transparent track), no `scrollbar-gutter`. typecheck + `npm run build` green.

Status: Fixed (pending `npm run dev` eyeball — xterm renders only in the real app, not the
harness, so the rendered bar can't be auto-verified).

## Verification

`npm run build` green (CSS compiles); confirm the terminal bar matches the panels in `npm run dev`.
