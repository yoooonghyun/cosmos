# TODO

Living checklist of outstanding work for cosmos. Maintained by the **wrap-up** skill at
the end of each iteration: completed items are checked off and newly surfaced work is added.
For the authoritative design see `docs/ARCHITECTURE.md`.

## In progress

- [ ] **Milestone 2 — render_ui MCP server + A2UI Generated-UI panel** (sdd cycle)
  - [x] Step 1 — Spec (`.sdd/specs/render-ui-v1.md`)
  - [ ] Step 2 — Plan (`.sdd/plans/render-ui-v1.md`)
  - [ ] Steps 3–5 — Interface / Tests / Implement
  - [ ] Step 6 — Wrap-up

## Next

- [ ] Manual GUI verification of Terminal Panel SC-001..SC-003 via `npm run dev` (live
  `claude` TUI appears within seconds; keystrokes/colors render; resize reflows). Requires a
  human at a desktop session.

## Deferred / future

- [ ] Decide whether session control stays purely interactive (PTY) or adds the Claude Agent
  SDK for background/headless work (ARCHITECTURE §7).
- [ ] `codegraph init` once the codebase has enough real source to index (ARCHITECTURE §7).

## Done

- [x] Milestone 1 — Terminal Panel (node-pty + xterm.js, typed IPC, 29/29 tests, build green).
- [x] Consolidated `.sdd/design.md` into `docs/ARCHITECTURE.md` as the single design reference.
