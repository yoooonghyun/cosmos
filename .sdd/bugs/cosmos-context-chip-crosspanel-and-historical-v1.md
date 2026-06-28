# Bug: context chip — always "Cosmos" for cross-panel submits + historical chip not working

ID: `cosmos-context-chip-crosspanel-and-historical-v1`
Skill: bugfix
Status: In progress (delegated to developer; escalate to architect if a contract/IPC change is needed)
Reported: 2026-06-28

## Symptoms (user)

1. The historical-turn chip still doesn't work at runtime (user doubts the test guard is real).
2. No matter which panel you submit from, the chip in the Cosmos timeline shows
   "Cosmos > conversation" — never the actual source panel (Jira/Slack/Confluence/Calendar).

## Orchestrator analysis

The HISTORICAL path is architecturally correct: `useGenerativePanelTabs.submit`
(`src/renderer/tabs/useGenerativePanelTabs.ts:583-593`) captures the right
`PromptContext` for the 4 generative panels — `panel = {id: target, label: panelName}`, the
active tab, and the dock from the live `viewContext` tagged with `DOCK_KIND_BY_PANEL` — and embeds
it via `buildAgentSubmitWithMarker`. So the transcript carries the correct panel context →
`transcriptParse` attaches `turn.context` → the historical chip should show e.g. "Jira > … ↳ PROJ-123".

### #2 root cause (real architecture gap — cross-panel LIVE context)
The Cosmos timeline's LIVE in-flight entry is seeded by `CosmosPanel`'s `agent:status 'started'`
handler, which sets `promptContext: lastPromptContextRef.current`. That ref is written ONLY by
`CosmosPanel.onSubmit` (cosmos-panel submits) and hard-codes `panel: {id:'cosmos', label:'Cosmos'}`.
For a submit that originates in Jira/Slack/etc, `CosmosPanel.onSubmit` is NOT called, so the ref
stays at its last cosmos value (or the cosmos default) → the live chip always reads "Cosmos >
conversation". The submitting panel's captured `PromptContext` (held in `useGenerativePanelTabs`)
never reaches the Cosmos timeline's live seed — there is no channel for it. FR-024's "live shows the
same context" was designed for cosmos-panel submits only; the cross-panel live flow is unspecified.

### #1 (historical not working at runtime)
Either (a) STALE DEV — the context feature + the just-committed `CosmosPanel` marker restore need a
full `npm run dev` restart, or (b) a real break in the marker→transcript→parse→chip round-trip. The
existing "historical" guard (`PromptContextChip.dom.test.tsx`) INJECTS `turn.context` directly, so it
proves the render but NOT the round-trip — it cannot detect a real marker/parse break. A faithful
guard must build a marker from a panel `PromptContext`, run it through the REAL
`parsePromptContextMarker`/`transcriptParse`, and assert the resulting turn renders the chip with
THAT panel.

## To do (developer)

1. #2 — make the Cosmos timeline's LIVE entry reflect the ACTUAL submitting panel's context. The
   captured `PromptContext` must flow from the submitting panel to the cosmos live seed. Prefer the
   minimal renderer-only mechanism (a shared "last submit context" the live seed reads, written by
   BOTH `useGenerativePanelTabs.submit` and `CosmosPanel.onSubmit`) over CosmosPanel's local ref.
   **If the clean fix needs a contract/IPC change (e.g. echoing the context back on `agent:status`),
   STOP and escalate to `architect`** — do not hack a wrong-layer patch.
2. #1 — add a REAL round-trip regression test (build marker from a non-cosmos panel context → parse
   via the real codec/`transcriptParse` → assert the rendered turn's chip shows that panel), not an
   injected-context test. Determine whether the runtime failure is stale-dev or a real break; fix if
   real.
3. Update `docs/TEST-SCENARIOS.md`.

## Verification

`npm run typecheck` + `npm test` + `npm run test:dom` green incl. the real round-trip + cross-panel
live tests (red→green). Live confirmation needs `npm run dev` restart (submit from Jira → cosmos
timeline live chip shows Jira, and the completed turn keeps Jira).
