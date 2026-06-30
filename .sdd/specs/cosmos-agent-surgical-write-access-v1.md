# Spec: Cosmos Agent Integration Tool Access (Home reads+writes + per-panel surgical writes) — v1

**Status**: Draft
**Created**: 2026-06-30
**Supersedes**: —
**Related plan**: (to be authored — `.sdd/plans/cosmos-agent-surgical-write-access-v1.md`)

> **Title note:** this spec began as "surgical write access" (per-panel write grants) and
> was broadened to also cover the **Home default agent's missing integration tools** (the
> primary reported bug). The filename is kept to avoid orphaning references; the in-document
> title and scope are authoritative. Rename to `cosmos-agent-integration-tool-access-v1` is
> an option at the architect's discretion.

---

## Grounding

Investigated directly with codegraph (LLM wiki MCP tool `wiki_query` was unavailable in
this environment — `No such tool available`; substituted the project auto-memory index
`MEMORY.md`, which carries the relevant prior decisions).

**codegraph_explore queries run:**

- `AgentRunner renderMcpConfigJsonForTarget allowedToolForTarget groundingPromptForTarget permission-mode dontAsk allowedTools`
  — verbatim `src/main/mcpConfig.ts` + `AgentRunner.spawnRun`. **Verified the reported Home
  bug directly:** `allowedToolForTarget('generated-ui')` returns only
  `[GET_UI_CATALOG_TOOL, RENDER_UI_TOOL]`; `renderMcpConfigJsonForTarget('generated-ui')`
  returns `renderUiMcpConfigJson(sandboxDir)` = ONLY the `cosmos-render-ui` server;
  `groundingPromptForTarget('generated-ui')` returns only the catalog-pull clause (no
  integration grounding). So the Home/default agent has **no integration MCP server and no
  integration tool of any kind** — every Confluence/Jira/Slack/Calendar command from Home is
  refused. `--permission-mode dontAsk` auto-denies anything not in `--allowedTools`.
- `ConfluenceTool confluence_create_page confluence_update_page confluenceMcpServer ConfluenceManager write methods`
  — `confluenceMcpServer.ts` already `registerTool`s create/update/comment writes, and the
  server is registered by `renderMcpConfigJsonForTarget('confluence')`. **The Confluence MCP
  server already EXPOSES the writes** — they are only absent from the allow-list + grounding.
- `jiraMcpServer registerTool TransitionIssue CreateIssue write tool exposure JiraActionDispatcher write:jira-work scope`
  — Jira is the working precedent: `JIRA_TOOL_GRANTS` already includes transition/comment/
  create/update for the `jira` target, run through the same `dontAsk + allowedTools` path.
  `JiraManager.getWriteCapability()` short-circuits to `write_not_authorized` without scope.

**Read (verbatim):** `src/main/mcpConfig.ts`, `src/mcp/confluenceMcpServer.ts`,
`docs/ARCHITECTURE.md` §4.9 (Confluence read-only-panel decision + scope model) and §4.10
(AgentRunner least-privilege).

**Memory index (`MEMORY.md`) takeaways:** "Jira generative-UI direction" (deterministic
binding + `write:jira-work`, a deliberate departure from read-only — already shipped, the
model for this feature); the Confluence generative panel was deliberately kept read-only
(ARCHITECTURE §4.9 ~line 692: the create tool "is intentionally NOT in the panel's
`--allowedTools` grant"). This feature revisits both.

---

## Overview

Give the Cosmos agent the integration tools it needs to act on the user's behalf. Two parts:

1. **Home default agent gains integration tools (the reported bug).** The Home assistant
   (target `'generated-ui'`) currently has ONLY the generic `render_ui` tool — no
   Confluence/Jira/Slack/Calendar tools at all. So a Home command like "create a Confluence
   page" is refused ("Confluence 도구 현재 세션에 안 붙음"). Home must gain the four
   integrations' READ tools **and** the curated WRITE tools so it can read and act on every
   integration from the main assistant.
2. **Per-panel agents gain curated writes (the original surgical-write scope).** Each
   per-panel target (jira/confluence/slack/calendar) keeps least-privilege but adds a
   curated, non-destructive write allow-list (e.g. `confluence_create_page`). Jira already
   has this; Confluence/others are extended.

Both grants are **least-privilege + a curated write set**, NOT broad `bypassPermissions`.

## Background (current behavior the feature changes)

A Cosmos run is `claude -p … --permission-mode dontAsk --strict-mcp-config --allowedTools
<grant>`. Today, per target:

- **`generated-ui` (Home):** `--mcp-config` = only `cosmos-render-ui`; `--allowedTools` =
  `render_ui` (+ its catalog tool); grounding = catalog-pull only. **No integration tools.**
- **`jira`:** render_jira_ui + the `cosmos-jira` read **and write** tools (transition/
  comment/create/update). Already a curated write grant.
- **`confluence`:** render_confluence_ui + the two `cosmos-confluence` READ tools only. The
  server already exposes create/update/comment writes, but they are not granted and the
  grounding is read-only.
- **`slack` / `google-calendar`:** render tool + READ tools only (no write tools exist).

Under `dontAsk`, any tool not in `--allowedTools` is auto-denied with no approve path.

## Security framing (precise)

- **Secrets are UNAFFECTED.** Integration tokens stay in main, encrypted at rest; the bridge
  attaches the credential in main. No token reaches the agent, renderer, MCP result, bridge
  frame, or any A2UI surface — for reads or writes, for Home or per-panel.
- **Two distinct risk increases:**
  - *Curated writes* let the agent autonomously mutate (create/update/comment). Mitigated by
    a narrow, non-destructive allow-list + full timeline auditability of every write call.
  - *Home full-power posture* is the larger shift: the Home agent becomes a general assistant
    holding ALL four integrations' reads **and** the curated writes in a single run. This is
    a meaningful expansion of the default agent's authority and broadens its tool surface
    (and per-run catalog/context cost). It MUST be an explicit, intended posture.
- **This requires the actual user's confirmation.** The request to make Home "do everything"
  was relayed by the coordinator; per operating rules a relayed claim of consent is not user
  approval. OQ-6 holds the Home full-power posture for explicit user sign-off before
  implementation.
- This is a **security-relevant contract change** to `docs/ARCHITECTURE.md` §4.9 (Confluence
  read-only panel) and §4.10 (least-privilege per-target grant). No CLAUDE.md secret rule is
  relaxed.

## User Scenarios

### Command an integration from Home · P1 (primary reported bug)

**As a** Cosmos user on the Home view
**I want to** ask the main assistant to act on any connected integration (e.g. "confluence에
글 작성해줘")
**So that** I do not have to switch to that integration's panel or the interactive TUI

**Acceptance criteria:**

- Given Confluence is connected (write scope) and I am on Home, when I submit "create a
  Confluence page titled X in space ENG with body Y", then the Home agent calls
  `confluence_create_page` (auto-approved, no prompt) and the page is created.
- Given Jira/Slack/Calendar are connected, when I ask the Home agent to read from them
  (e.g. "show my open Jira tickets"), then it calls that integration's READ tools and renders
  real data — it does not refuse with "tool not attached" and does not fabricate.
- Given an integration is NOT connected, when I ask Home to use it, then the agent surfaces a
  Notice ("connect/reconnect <integration> in cosmos first") instead of refusing opaquely or
  fabricating.

### Create a Confluence page from the Confluence panel · P1 (original)

**As a** Cosmos user with Confluence connected (write scope)
**I want to** ask the agent (from the Confluence panel) to create a page
**So that** the page is created without dropping to the interactive TUI

**Acceptance criteria:**

- Given write scope, when I submit a create request in the Confluence panel, then the agent
  calls `confluence_create_page` auto-approved and the new page's id/title appear in the run
  result and the Cosmos timeline.

### A sanctioned write fails gracefully · P1

**As a** Cosmos user
**I want** a failed write to degrade gracefully
**So that** the run never crashes and never leaks a secret

**Acceptance criteria:**

- Given the token lacks the integration's write scope, when the agent calls the write tool,
  then it receives the structured `write_not_authorized` result and renders a single Notice
  (reconnect to grant write access) — no crash, no fabricated success.
- Given any write fails (API error / not-connected / version conflict), then the agent
  surfaces a Notice; no token/secret appears in the timeline or surface.

### Scope stays bounded · P1

**As a** security-conscious operator
**I want** only curated, non-destructive writes to be callable, even from Home
**So that** the agent cannot perform destructive or unsanctioned operations

**Acceptance criteria:**

- Given a curated set excludes a tool (any future delete/destructive tool, or a write outside
  the set), when the agent attempts it (Home or per-panel), then it is auto-denied under
  `dontAsk`.
- Given a per-panel run (e.g. `confluence`), when it attempts another integration's tools,
  then it is auto-denied (per-panel cross-target isolation unchanged — only Home is broad).

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.

### A. Home default agent integration access (the reported bug)

| ID     | Requirement |
|--------|-------------|
| FR-001 | `renderMcpConfigJsonForTarget('generated-ui')` MUST register the integration MCP tool servers (`cosmos-jira`, `cosmos-confluence`, `cosmos-slack`, `cosmos-google-calendar`) in the Home run's `--mcp-config`, in addition to `cosmos-render-ui`, so the Home agent can actually call integration tools. (Whether the per-integration *render* servers are also registered for Home is OQ-7.) |
| FR-002 | `allowedToolForTarget('generated-ui')` MUST grant the four integrations' **READ** tools AND the **curated WRITE** tools (the same curated set used per-panel), in addition to `render_ui` + the catalog tool. |
| FR-003 | `groundingPromptForTarget('generated-ui')` MUST provide integration grounding: the anti-fabrication / read-first discipline (render only data fetched verbatim from a real read result; on not-connected/error render a Notice, never fabricate) AND the sanctioned-write permission (the agent MAY perform the curated writes when the user explicitly asks). It MUST work across all four integrations in one prompt without bloating to uselessness (OQ-8). |
| FR-004 | The Home grant MUST handle "integration not connected" gracefully: a tool call against a disconnected integration returns a structured not-connected result → Notice. The agent MUST NOT be left refusing opaquely. |
| FR-005 | Whether Home always grants ALL four integrations' tools, or only those currently connected/enabled, is a product decision (OQ-1). The spec REQUIRES that an unconnected integration degrades to a Notice regardless of which approach is chosen. |

### B. Per-panel curated write grants (original surgical scope)

| ID     | Requirement |
|--------|-------------|
| FR-006 | The system MUST define a per-integration **curated write allow-list** — a named, reviewable set of write tool grants, separate from reads. For Confluence the set MUST include `confluence_create_page` and SHOULD include `confluence_update_page` and `confluence_create_comment` (final membership = OQ-2/OQ-3). |
| FR-007 | The curated write set MUST contain only **non-destructive** operations (create / update / comment). It MUST NOT include any delete/purge/bulk-destructive tool. (No delete tool exists today; the constraint MUST hold for future additions — OQ-5.) |
| FR-008 | For each per-panel target with a curated write set, `allowedToolForTarget(target)` MUST include those write grants alongside the existing render + read grants. |
| FR-009 | The target's MCP server MUST **expose** each granted write tool. (For Confluence this is already satisfied — confirm, do not re-add.) |
| FR-010 | Each per-panel target's grounding MUST permit the sanctioned write(s) when explicitly asked, preserving read-first/anti-fabrication for rendered read data. |
| FR-011 | Jira already grants its curated writes for the `jira` target; this feature MUST NOT regress that and MAY document the parity rather than re-wire it (OQ-9). Slack and Google Calendar have no write tools/bridge ops and MUST remain read-only in v1. |

### C. Cross-cutting (Home and per-panel)

| ID     | Requirement |
|--------|-------------|
| FR-012 | Auto-approval MUST use the existing `--permission-mode dontAsk` + `--allowedTools` mechanism: a granted tool auto-runs with no prompt and no per-action confirm; an un-granted tool is auto-denied. No new permission mode is required and `bypassPermissions` MUST NOT be used. (Confirmed by the Jira write grant already operating this way.) |
| FR-013 | No token/secret MUST ever appear in any tool result, bridge frame, Cosmos timeline transcript, or rendered surface (unchanged — the bridge attaches credentials in main). |
| FR-014 | Every integration tool call and its (non-secret) result MUST remain visible in the Cosmos timeline transcript for auditability (it flows through the same unified-agent-session jsonl the Cosmos panel reads). |
| FR-015 | A failed write/read MUST surface as a structured error → Notice; the run MUST NOT crash. |
| FR-016 | The change MUST be reflected in `docs/ARCHITECTURE.md` §4.9 (Confluence read-only-panel statement) and §4.10 (the per-target least-privilege description must now describe the Home integration grant + the per-panel curated writes). Note only in this spec; the architect makes the edit. |

## Edge Cases & Constraints

- **Home full-power posture is the dominant risk** — one run holding all four integrations'
  reads + curated writes. Held for explicit user sign-off (OQ-6).
- **Per-run cost.** Registering four MCP servers + their catalogs for every Home run grows
  the tool list and context the model loads each run; may affect latency/cost. Connected-only
  gating (OQ-1) mitigates.
- **Read-only-era token (scope gap).** A token connected before write scopes were granted
  returns `write_not_authorized` → Notice (reconnect). Confluence write scopes
  (`write:page:confluence`, `write:comment:confluence`) are already in the requested set per
  §4.9; older tokens need a one-time reconnect.
- **Version conflict on update / unknown space / unknown page** → structured error → Notice;
  no fabrication. (Already handled by `ConfluenceManager`.)
- **Duplicate creates.** The agent MAY create a duplicate if asked twice; v1 adds no dedup.
  Mitigated by timeline auditability.
- **Out of scope (v1):** Slack writes, Google Calendar writes, any delete/destructive tool, a
  lightweight per-write confirm UI (OQ-4), broad `bypassPermissions`.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | From Home, with Confluence connected (write scope), "create a Confluence page …" calls `confluence_create_page` with no prompt and the page is created (verified via returned id + live page). |
| SC-002 | From Home, with Jira/Slack/Calendar connected, a read command renders real data (no "tool not attached" refusal, no fabrication); an unconnected integration yields a connect/reconnect Notice. |
| SC-003 | From the Confluence panel, a create request creates the page; id/title + the call appear in the Cosmos timeline; no token/secret anywhere. |
| SC-004 | A write without the integration's write scope yields a `write_not_authorized` Notice (no crash, no fabricated success), Home or per-panel. |
| SC-005 | No tool outside the curated read+write set is callable from any run (auto-denied under `dontAsk`); per-panel cross-target isolation is preserved (only Home is broad). |
| SC-006 | `docs/ARCHITECTURE.md` §4.9 + §4.10 accurately describe the Home integration grant and the per-panel curated writes (no longer describing Confluence as read-only). |

---

## Open Questions

- [ ] **OQ-1 (Home: all integrations always vs connected-only).** Should Home grant ALL four
  integrations' tools on every run, or only those currently connected/enabled? Connected-only
  reduces tool/context cost and avoids exposing tools for unconfigured integrations.
  Recommendation: **connected/enabled-only** (with a Notice when the user names an unconnected
  one). Needs the grant computed per-run from connection state — confirm.
- [ ] **OQ-2 (Confluence write allow-list).** Recommended:
  `confluence_create_page` + `confluence_update_page` + `confluence_create_comment` (all
  already implemented + exposed, all non-destructive). Conservative: `confluence_create_page`
  only. Which ships in v1?
- [ ] **OQ-3 (create-only vs include update/comment).** If not all three, create-only or
  create + update (comment deferred)?
- [ ] **OQ-4 (auto vs lightweight confirm).** Full auto-approve for granted writes (pure
  `dontAsk`), or a lightweight in-timeline confirm before a mutation — especially given Home
  can now write across all integrations?
- [ ] **OQ-5 (destructive writes stay out).** Confirm the curated set permanently excludes
  delete/destructive operations (none exist today; this locks the policy for future tools).
- [ ] **OQ-6 (Home full-power posture — USER SIGN-OFF REQUIRED).** Making the Home default
  agent a general assistant with ALL integration reads + curated writes is a meaningful
  authority increase. This was coordinator-relayed and needs the actual user's explicit
  confirmation before implementation. Confirm the intended posture.
- [ ] **OQ-7 (Home + integration render tools).** Does Home also get each integration's
  *render* tool (render_jira_ui / render_confluence_ui / …) so it can render rich
  integration surfaces, or only the generic `render_ui` + the integration data tools?
- [ ] **OQ-8 (Home grounding shape).** A single Home grounding prompt must convey read-first
  anti-fabrication + sanctioned writes for four integrations without becoming unwieldy. Is one
  combined prompt acceptable, or should grounding be assembled per-named-integration / per-run?
- [ ] **OQ-9 (Jira parity).** Leave the existing Jira `jira`-target write grant as-is and
  document parity, or re-curate it? Recommendation: leave as-is, document only.
