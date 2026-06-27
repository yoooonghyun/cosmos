# TEST-SCENARIOS.md — the test-scenario registry

A single, living registry of every load-bearing test scenario in cosmos, across all
test layers. **Owned by the test agent** (`test-engineer`): the sdd/bugfix cycles delegate
test authoring to it, and it MUST read + update this file before writing new tests.

## Why this exists

Tests kept contradicting each other and silently regressing. The classic case: a
"channel name above the list" test wanted a header stacked above a message list, while a
"per-list independent scroll" test required multiple lists side-by-side — both controlled
by the SAME CSS seam, so a fix for one broke the other (and node unit tests, which only
assert class strings, could not see it). A central registry lets the test agent detect
that a NEW scenario would contradict an EXISTING invariant **before** writing the test,
instead of discovering it as a red→whack-a-mole later.

## How the test agent uses it

1. **Before writing tests:** scan this file for scenarios touching the same module / CSS
   seam / IPC channel / behavior. If the new test would contradict an existing invariant,
   STOP and surface the conflict (it is a product decision, not a test detail).
2. **After writing tests:** add/lift each new scenario here (id, invariant, layer, file),
   and record any cross-scenario tension in **Known tensions** below.
3. **When a fix changes an invariant:** update the affected row(s) here in the same change,
   so the registry never lies about what is asserted.

## Test layers (necessary AND sufficient bar)

| Layer | Env / runner | Catches | Script |
|-------|--------------|---------|--------|
| node-unit | vitest, node, no jsdom | pure logic, class-string construction, reducers | `npm test` |
| node-integration | vitest, node, real fs temp dirs + injected spawn/clock | IPC handlers, the `cosmos-file` protocol stream, agentRunner spawn/queue, MCP stdio | `npm run test:integration` |
| jsdom-component | vitest, jsdom + testing-library | component render, DOM events, hooks (scroll, keymap, focus) | `npm run test:dom` |
| visual | Playwright + Vite test page | computed layout / pixels (side-by-side, fill, scroll position, canvas) | `npm run test:visual` |
| e2e | Playwright `_electron` (real app) | preload bridge, custom protocol, session lifecycle end-to-end | `npm run test:e2e` |

> **Bar for "done":** a renderer/UI change needs a jsdom or visual test; a main-process
> server / IPC / protocol change needs a node-integration (or e2e) test. Green `npm test`
> (node-unit) + `typecheck` are NECESSARY but NOT SUFFICIENT — they cannot see runtime.

## Scenario registry

| ID | Invariant (what must hold) | Layer | Test file |
|----|----------------------------|-------|-----------|
| SL-SCROLL-01 | Two+ Slack message lists lay out side-by-side (same top, different left), each its own scroll container, independent scrollTop, filling panel height (no unified outer scroll) | visual | `tests/visual/layout.visual.spec.ts` |
| SL-SCROLL-02 | A non-list header (channel name) in a Column stacks ABOVE its list (header.bottom ≤ list.top) — withOUT breaking SL-SCROLL-01 | visual | `tests/visual/layout.visual.spec.ts` |
| SL-SCROLL-03 | A history list opens scrolled to the LATEST (bottom) message on initial load / channel switch; a top load-more (prepend) preserves position. Applies to BOTH the native (`kind='radix-viewport'`) and the GENERATIVE catalog (`kind='self'`) list — `useSlackScrollToLatest` holds its target in STATE (a `{current}`-shaped handle that re-keys the layout effect on attach) so the self-mode bottom-jump actually fires (bug slack-generative-scroll-to-latest-v1; was silently skipping). | visual + node-unit + jsdom | `tests/visual/layout.visual.spec.ts`, `src/renderer/slackScrollToLatest.test.ts`, `src/renderer/useSlackScrollToLatest.dom.test.tsx` (jsdom self-mode wiring — green) |
| SL-PAGE-01 | Scrolling near the top auto-loads the older page once (guarded), and the prepend preserves scroll position (anchor) | jsdom + node-unit | `src/renderer/slackScrollPaginate.test.ts`, `src/renderer/useSlackScrollPaginate.dom.test.tsx` (jsdom hook wiring — green) |
| SL-PAGE-02 | The GENERATIVE catalog `MessageList` also auto-loads older messages on scroll-to-top: `useSlackScrollPaginate` accepts `kind='self'` (the `SLACK_LIST_SCROLL_CLASS` div IS the scroller; no Radix viewport descendant) and, on a near-top scroll with a next page (`hasMore`) and not-loading (`loading`), fires the SAME `adapter.loadMore` action `LoadMoreButton` dispatches (`{ surfaceId, region? }`) — renderer-side only, no new adapter contract (the older page accumulates main-side via `updateDataModel`). Guarded against double-fire; exhausted (`hasMore=false`) never fires. | jsdom + node-unit | `src/renderer/slackScrollPaginate.test.ts`, `src/renderer/useSlackScrollPaginate.dom.test.tsx` (`kind='self'` cases — green) |
| FV-PDF-01 | A document (pdf/docx/xlsx) opened from a tab root loads its bytes over the typed `window.cosmos.fs.readBytes` IPC — NOT a cross-scheme `cosmos-file` fetch/XHR (Chromium refuses a custom scheme from the http dev origin). e2e asserts the bridge exists + returns a typed result (never throws); the http visual harness still asserts the react-pdf canvas renders. Full canvas-render through a LIVE pane root remains a manual check (e2e has no programmatic `claude` cwd). | e2e (real IPC bridge) + visual (http canvas) + node-integration (bytes) | `tests/e2e/app.e2e.spec.ts` (readBytes bridge), `tests/visual/layout.visual.spec.ts` (canvas), `src/main/fsExplorer.integration.test.ts` (readBytes bytes) |
| FS-PROTO-01 | Both byte paths confine + size-cap: the `cosmos-file` protocol handler (`<img>` images) streams an in-root file (200) / refuses out-of-root/forged/missing/dir (non-2xx); the `fs:readBytes` IPC (pdf/docx/sheet documents) returns `{ok:true,bytes}` for in-root, `too-large` over the per-format cap, and `out-of-root`/`not-found` for forged/escaped/missing — never throws, no absolute path leaks | node-integration | `src/main/localFileProtocol.integration.test.ts` (img scheme), `src/main/fsExplorer.integration.test.ts` (readBytes IPC) |
| AGENT-SESS-01 | Serialized same-session runs NEVER collide on the session id ("already in use"); every target passes the persistent `--session-id`; submits queue + drain one at a time. THE LOAD-BEARING PART (session-id-already-in-use-runtime-v1): the serializer alone is NOT enough — the just-exited `claude` child can still hold its `~/.claude/sessions/<pid>.json` REGISTRY entry when the next same-id run is drained, so claude rejects it "Session ID … is already in use". The runner now mirrors the PTY `--resume` path: on an in-use exit it plans a backoff via the shared `planResumeRetry` (injected `SessionLockEnv`) and RE-SPAWNS the SAME submit after the delay instead of erroring + draining. Integration test injects a stale dead-pid registry stub, fakes timers, and asserts the queued child is NOT spawned immediately and IS spawned after the backoff (RED without the retry wiring, GREEN with it); also covers retry-then-drain success and budget-exhausted give-up. | node-integration (green) | `src/main/agentRunner.integration.test.ts` |
| TAB-NAV-FOCUS-01 | Cmd+Opt+Arrow (`tab:next`/`tab:prev`) moves the FILE tabs when the editor/viewer pane holds focus, and the TERMINAL tabs otherwise — the routing follows focus, not a fixed strip (terminal-focus-aware-tab-nav-v1; was always moving terminal tabs). Pure routing predicate + cycle stay in `.ts`; the focus→routing wiring is asserted in jsdom | node-unit + jsdom | `src/renderer/closeTabRouting.test.ts`, `src/renderer/panelTabs.test.ts` (cycle), `src/renderer/TerminalTabNavRouting.dom.test.tsx` |
| TAB-NAV-FOCUS-02 | When the REAL Monaco editor holds focus, `viewerFocused` flips true so Cmd+Opt+Arrow moves the FILE tabs (terminal-tab-nav-monaco-focus-v1; was moving terminal tabs). GOTCHA — Monaco creates its editor with NO `overflowWidgetsDomNode`, so it mounts its hidden keyboard-input `<textarea>` on `document.body`, OUTSIDE the FileViewer subtree; the editor's DOM `focusin` therefore NEVER bubbles to the FileViewer outer div's `onFocus`. The fix drives viewer-focus from Monaco's OWN `onDidFocusEditorText`/`onDidBlurEditorText` in `MonacoText`, not DOM bubbling. TEST REQUIREMENT — a plain-div `fireEvent.focus` test (the original TAB-NAV-FOCUS-01 harness) is structurally insufficient and gives false confidence: it CANNOT reproduce Monaco mounting its input outside the tree. `MonacoFocusNav.dom.test.tsx` asserts the REAL `MonacoText`→`onViewerFocusChange` path (RED on the un-wired editor: no listeners registered → undefined; GREEN with the fix), mocking only the `monaco` namespace because monaco-editor cannot construct under jsdom (needs DOMMatrix/canvas/layout). The FULL real-editor end-to-end (a real textarea on body + a real keystroke moving the file tab) is ONLY catchable by e2e against a live pane — deferred: `COSMOS_E2E` mode spins up no programmatic `claude` cwd, so opening a real file in the editor through e2e is not yet wired (same gap as FV-PDF-01's live-pane canvas). | jsdom (real MonacoText wiring) + node-unit (routing) | `src/renderer/fileExplorer/MonacoFocusNav.dom.test.tsx`, `src/renderer/closeTabRouting.test.ts` |
| CF-COMMENT-AUTHOR-01 | A footer-comment's author resolves to the display NAME (not the raw account id) on top-level comments AND replies: `getComments` reads the realistic v2 author (`version.authorId`), resolves it via the SAME authed `GET /wiki/rest/api/user` path (Bearer attached), and reads the v1 user body's top-level `displayName`. The runtime fix is the granular `read:user:confluence` OAuth scope — WITHOUT it the user endpoint 403s and the author degrades to the raw id (node-unit stubs masked this; the integration test models the gateway 403 so it is RED on the missing scope). A user-lookup failure degrades to the raw id (never throws) | node-integration | `src/main/confluenceComments.integration.test.ts` |

(Extend this table as scenarios are added. Mark unbuilt ones TODO so gaps are visible.)

## Known tensions (cross-scenario conflicts to respect)

- **SL-SCROLL-01 vs SL-SCROLL-02 (RESOLVED):** both ride `SLACK_LAYOUT_FILL_CLASS`. The
  resolution is: do NOT force `[&>*]:!flex-row` and do NOT add `flex-wrap`/`content-start`.
  The SDK keeps its natural direction — a Row interior splits lists side-by-side (SL-SCROLL-01);
  a Column interior stacks a header above its list (SL-SCROLL-02); per-list `flex-1 min-h-0
  overflow-y-auto` preserves independent scroll either way. A change to that class MUST keep
  BOTH visual tests green. See `feedback-slack-per-list-scroll` memory.
- **SL-SCROLL-03 vs SL-PAGE-01:** initial-bottom-jump must be mutually exclusive with
  near-top auto-load (the first non-empty render jumps to bottom; later grows anchor-preserve).
  A test for one must not assume the other fired.
