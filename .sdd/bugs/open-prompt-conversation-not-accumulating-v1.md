# Bug: Open-Prompt conversations from non-default panels don't accumulate in Cosmos panel — v1

**Status**: Escalated to SDD
**Created**: 2026-06-27

## Report

The Cosmos conversation panel (cosmos-conversation-panel-v2, step 3) shows the persistent DEFAULT
agent session transcript. Open-Prompt conversations spoken from the Jira / Slack / Confluence /
Calendar panels do NOT appear there.

## Root cause (confirmed in code)

The persistent `--session-id` + submit serialization are gated on the target being the default
`'generated-ui'` target only:
- `src/main/agentSessionQueue.ts` — `isPersistentSessionTarget(target)` (`=== 'generated-ui'`),
  `PERSISTENT_SESSION_TARGET = DEFAULT_UI_RENDER_TARGET`, `decideSubmit` drops non-default while busy.
- `src/main/agentRunner.ts` — `usesPersistentSession(target)` gates `--session-id`; non-default
  targets run EPHEMERALLY (no `--session-id`), so `claude` records them to a different/no transcript,
  and the Cosmos reader (`transcriptReader.ts`, confined to the one default-session jsonl) never sees
  them.

## Scope gate → SDD

This is an architecture/contract change (decouple session from render target; serialize all targets;
remove the ephemeral path), not a spot fix. Escalated.

- Spec: `.sdd/specs/unified-agent-session-v1.md`
- Plan: `.sdd/plans/unified-agent-session-v1.md`

User-chosen model: ONE unified persistent session shared across ALL Open-Prompt targets. Accepted
tradeoffs: panels share conversation context; runs serialize (no two `--session-id <same id>`
concurrently).
