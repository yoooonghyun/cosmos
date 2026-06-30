# generated-ui panel dead-code cleanup (v1)

Scoped investigation: the experimental generic "Generated UI" rail PANEL was removed
previously. Task = remove ONLY genuinely-dead leftover that traces to that removed panel,
while PRESERVING the still-LIVE `'generated-ui'` WIRE TARGET (`UiRenderTarget`) the
Home/Cosmos agent depends on. Conservative bias; prove zero-impact before removing.

## Outcome (TL;DR)

**No code removed.** The removed PANEL's component + rail registration are already fully
gone (no `GeneratedUiPanel` component, no `'generated-ui'` rail render in `App.tsx`, no
`'generated-ui'` entry in `RAIL_LABEL`/`surfaceIcons`/`SurfaceId`). Every remaining
`'generated-ui'` reference is one of:

1. the LIVE `UiRenderTarget` wire id (explicitly protected — agent/MCP/bridge/validators/
   Cosmos consume path), or
2. **load-bearing type-narrowing glue** in `useGenerativePanelTabs` (UiRenderTarget →
   CrossPanelId) — removing it requires a public-contract type change, out of scope for
   dead-leftover cleanup, and the field IS the real wire target submitted to the agent, or
3. the **always-empty persisted snapshot slot** `panels['generated-ui']` — woven into the
   schema/type/`GenerativePanelKey` union + ~6 test files; the task's explicit
   "risks the persisted schema → KEEP" escape hatch applies.

There is genuinely nothing safe to remove. The two candidate "dead branches" the task
flagged (#1 hook ternary, #2 snapshot slot) are each load-bearing / schema-coupled, so per
the hard guardrail "When in doubt, KEEP + report it" both are deliberate keeps.

## Grounding (queries run)

- `grep -rn "generated-ui" src tests docs` — full census of all ~90 references (one takeaway:
  every hit classifies into the buckets below; none is an orphan).
- `codegraph_explore useGenerativePanelTabs SessionSnapshot assembleSnapshot validateSnapshot
  emptyGenerative useReportPanel useRestoredGenerativePanel` — verbatim source of the snapshot
  assemble/validate/report/restore paths.
- `codegraph_callers useGenerativePanelTabs` + `grep "useGenerativePanelTabs("` — exactly 4
  call sites: `JiraPanel`, `SlackPanel`, `ConfluencePanel`, `GoogleCalendarPanel`. NONE passes
  `target: 'generated-ui'`; CosmosPanel does NOT use this hook (uses `cosmosTabs`).
- `codegraph_explore useReportPanel useRestoredGenerativePanel ... blast radius` — callers of
  `useReportPanel` = the 4 generative panels (via the hook) + `TerminalPanel`; callers of
  `useRestoredGenerativePanel` = the 4 generative panels (jira/slack/confluence/calendar).
  NEITHER ever references the `'generated-ui'` key.
- `grep App.tsx / RAIL_LABEL / surfaceIcons / find src -iname "*generated*"` — no dead panel
  component, no dead rail entry, no dead label.

## Classification of every `'generated-ui'` usage

### LIVE — KEPT (protected wire target; do not touch)

- `src/shared/ipc/common.ts` — `UiRenderTarget` member + `DEFAULT_UI_RENDER_TARGET = 'generated-ui'`.
- `src/shared/ipc/ui.ts` / `ui.validate.ts`, `agent.ts` / `agent.validate.ts`, `bridge.ts`,
  `validate.ts`, `validateUi.test.ts`, `adapter.validate.ts` (permissive source union),
  `validateAdapter.test.ts` — the wire-target type + its boundary validators.
- `src/mcp/renderUiServer.ts` — the render tool + catalog default target.
- `src/main/mcpConfig.ts` grants (`allowedToolForTarget`/`renderMcpConfigJsonForTarget`/
  `groundingPromptForTarget` for `'generated-ui'`) + `mcpConfig.test.ts` — **NOT TOUCHED**
  (owned by the concurrent surgical-write spec).
- `src/main/agent/agentRunner.ts` (default target = generated-ui) + its tests; `uiBridge.ts`
  settle-on-push for non-generated-ui + tests; `viewContextGrounding.ts`; `index.ts`
  open-prompt-spinner gating (`payload.target === 'generated-ui'`).
- `src/renderer/cosmos/CosmosPanel.tsx` — `buildAgentSubmitWithMarker(utterance,
  'generated-ui', …)` submit + `onRender(p => p.target !== 'generated-ui' …)` consume path;
  plus all Cosmos `*.dom.test.tsx`, `cosmosConversation.ts`, `viewContextCapture.ts`,
  `promptComposerLogic.ts`, `railVisibility.ts` comments. All live Home path.

### DELIBERATE KEEP (flagged as removable, but load-bearing / schema-coupled)

**#1 — `useGenerativePanelTabs.ts` lines ~327 & ~360 `target === 'generated-ui' ? null : …`**

Zero-runtime-reach is PROVEN (the only 4 callers pass jira/slack/confluence/google-calendar;
CosmosPanel uses `cosmosTabs`). BUT these are not removable as "dead code" — they are the
**type bridge** from the hook's declared option `target: UiRenderTarget` to the panel-tabs
tree id `CrossPanelId` (`Exclude<SurfaceId,'cosmos'>`, which excludes `'generated-ui'`).
`const panelTabsPanelId: CrossPanelId | null = target === 'generated-ui' ? null : target`
relies on the ternary to NARROW `UiRenderTarget` to the CrossPanelId-assignable subset;
deleting it makes `panelTabsPanelId = target` fail typecheck. Removing it cleanly would mean
narrowing the public option type `target: UiRenderTarget` → `Exclude<UiRenderTarget,
'generated-ui'>`. That is a **public-contract change**, and `target` is genuinely the wire
`UiRenderTarget` (it is passed straight into `buildAgentSubmitWithMarker(utterance, target,
…)` and `window.cosmos.agent.submit`), so `UiRenderTarget` is the semantically correct type.
This is type-correct generic-hook handling, not leftover from the removed panel → KEEP
(guardrail: do not redesign / do not remove load-bearing code).

**#2 — persisted snapshot slot `panels['generated-ui']`**

Confirmed always `emptyGenerative()`: no `useReportPanel('generated-ui', …)` and no
`useRestoredGenerativePanel('generated-ui')` caller exists. BUT removing it is NOT clean — it
touches the persisted schema shape and many coupled sites:
`src/shared/ipc/session.ts` (`SessionSnapshot.panels['generated-ui']` + `GenerativePanelKey =
Exclude<keyof panels,'terminal'>`, a 5→4 union change that ripples to the live hook's
`report(target as GenerativePanelKey)` and `useRestoredGenerativePanel(key)`),
`src/main/session/sessionSnapshot.ts` (`GENERATIVE_KEYS`, `emptySnapshot`, `validateSnapshot`),
`src/renderer/session/sessionRegistry.ts` (`assembleSnapshot` param + body),
`src/renderer/session/sessionRegistry.ts` contributions, plus `sessionSnapshot.test.ts`,
`sessionStore.test.ts`, `sessionRegistry.test.ts`. This is exactly the task's
"if removing it risks the persisted schema / other readers, KEEP it" case → KEEP
(conservative bias; churn not worth it).

### NOT THE SAME THING (unrelated symbols — left as-is)

- `src/renderer/jira/JiraPanel.tsx` `onGeneratedUi` — a LOCAL boolean ("this Jira tab shows a
  composed surface"), unrelated to the removed panel.
- Various `"Generated UI"` / `"Generated-UI panel"` strings in comments/doc-strings/tool
  descriptions — describe the wire target conceptually; live or cosmetic, not dead code.

## Stale documentation noted (NOT edited — architect-owned, concurrent edits in flight)

`docs/ARCHITECTURE.md` still describes a present-tense **"Generated-UI panel"** rail surface
(≈ lines 311, 393) and `src/shared/ipc/common.ts:19` / `renderUiServer.ts:194` prose calls
`'generated-ui'` "the generic Generated-UI panel". The panel surface no longer exists (the
Cosmos/Home panel renders the `'generated-ui'` wire frames). These are stale prose, not dead
code. Left for `architect` to reconcile (ARCHITECTURE.md is architect-owned and a concurrent
architect edit is in flight); flagged here so the next wrap-up/architect pass can update the
wording to "the Cosmos/Home panel renders `'generated-ui'` frames".

## Verification

No code changed → no removal to prove. (The working tree also carries extensive concurrent
WIP unrelated to this task, so a full-suite run would not be attributable to this work.) The
proof obligation here is the zero-caller / zero-reach evidence above, which establishes that
the only removable-looking candidates are in fact load-bearing or schema-coupled keeps.

## Recommendation

Close as "no dead leftover remains." If a future task still wants #1/#2 gone, do it as a
deliberate small refactor (narrow `useGenerativePanelTabs` `target` type; drop the
`'generated-ui'` persisted slot + shrink `GenerativePanelKey`) with its own test churn — that
is a contract/schema change, not dead-code removal, and should be scoped accordingly (likely
folded into later task "B", the `'generated-ui'` → `'cosmos'` rename).
