# Spec: Slack + Confluence Generative UI — v1

**Status**: Draft
**Created**: 2026-06-06
**Supersedes**: —
**Related plan**: `.sdd/plans/slack-confluence-generative-ui-v1.md` (to be authored next)

---

## Overview

Give the **Slack** and **Confluence** rail panels the same **generative-view** UX the **Jira** panel
already has (§4.9/§4.10, `jira-generative-ui-v2`): a prompt composer in each panel where a typed
utterance drives a headless `claude -p` run that fetches REAL data via that integration's existing
read MCP tools and composes its own A2UI surface, rendered in that panel through a per-panel custom
catalog. This mirrors the Jira generative-UI architecture end-to-end **minus writes**: Slack and
Confluence have no write tools/scopes, so these generative surfaces are **read-only / display-only**.

### Why a single combined spec (not two)

Slack and Confluence share ~95% of the mechanism: the same render-target routing, the same headless
`AgentRunner` path, the same grounding/anti-fabrication discipline, the same per-panel custom-catalog
+ scoped render-tool pattern, the same spinner-settle requirement, and the same security invariant.
They differ ONLY in their resource vocabulary (channels/messages/users vs. spaces/pages/search
results/page detail). Splitting would duplicate every mechanism requirement and risk drift between two
panels that must behave identically. The two integrations are therefore one spec; the eventual plan
sequences the work **Slack first, then Confluence**, run consecutively.

---

## User Scenarios

> Each scenario is independently testable. Prioritized P1 (must), P2 (should), P3 (nice to have).
> "the panel" means the Slack panel OR the Confluence panel — every scenario applies to BOTH.

### Transform a panel by an utterance typed in it · P1

**As a** cosmos user
**I want to** type a request into a prompt input that lives in the Slack (or Confluence) panel
**So that** the panel's body composes into the Slack/Confluence surface I asked for, in place

**Acceptance criteria:**

- Given Slack/Confluence is connected and a prompt input is present in that panel, when I submit a
  non-empty utterance, then the headless agent reads that integration via its existing read MCP tools
  and composes a surface that renders **in that same panel's body** — not in the Jira panel, not in
  the generic Generated-UI panel.
- Given an utterance-driven surface is composed, when it renders, then it uses **that panel's custom
  catalog** (`catalogId: 'slack'` or `catalogId: 'confluence'`) and presents only data already
  abstracted in `src/shared/slack.ts` / `src/shared/confluence.ts` — no parallel resource shapes are
  invented.
- Given an utterance run is in progress, when I look at the panel, then the panel reflects an
  in-progress state (the prior surface, if any, may stay visible) and an empty/whitespace utterance
  starts no run.
- Given the run fails or cannot start, when it returns, then the panel shows a persistent,
  human-readable error and the prompt input stays usable — the panel never hangs or crashes.
- Given the run completes (a surface was rendered), when it returns, then the in-progress spinner
  stops (the run is not left blocked awaiting an action that read-only surfaces never produce).

### Surfaces are built from REAL data only · P1

**As a** cosmos user
**I want to** the generated surface to reflect my actual Slack/Confluence data
**So that** I can trust the panel rather than seeing fabricated channels, messages, or pages

**Acceptance criteria:**

- Given I submit an utterance, when the agent composes the surface, then every channel name, message,
  user name, space, page title, excerpt, and body shown MUST come verbatim from a read-tool result in
  that run — never invented, guessed, paraphrased, or copied from the render tool's example.
- Given Slack/Confluence is NOT connected (or a read tool returns an error), when the run composes,
  then the agent renders a single **Notice** explaining that (and to connect/reconnect in cosmos)
  INSTEAD of fabricating any data.
- Given a read returns empty results (no channels / no search hits), when the surface renders, then it
  conveys "nothing found" rather than inventing placeholder rows.

### Each panel keeps its connect affordance · P1

**As a** cosmos user
**I want to** the panel to still show its Connect/Reconnect call-to-action when I'm not connected
**So that** I'm never asked to type into a composer that cannot work

**Acceptance criteria:**

- Given Slack/Confluence is NOT connected (or needs reconnect), when I open the panel, then it shows
  the existing native Connect/Reconnect affordance (unchanged), and the prompt composer is **not
  usable** (no run can be started from a not-connected panel).
- Given Slack/Confluence is connected, when I open the panel, then the prompt composer is present and
  usable.

### Custom catalog gives native-panel design parity · P2

**As a** cosmos user
**I want to** the generated Slack/Confluence surface to look like the rest of cosmos
**So that** the panel reads as one product whether the body is the existing browser or agent-composed

**Acceptance criteria:**

- Given a Slack surface renders channels/messages/users, when I look at it, then it uses the same
  cosmos palette + chrome the native Slack panel uses (no Slack brand color, no raw hex).
- Given a Confluence surface renders spaces/pages/search results/page detail, when I look at it, then
  it uses the same cosmos palette + chrome the native Confluence panel uses.

### Single-run guard is shared across panels · P3

**As a** cosmos user
**I want to** utterances across panels to run one at a time
**So that** the headless agent never runs concurrent overlapping sessions

**Acceptance criteria:**

- Given a run (in ANY panel — Slack, Confluence, Jira, or Generated-UI) is in flight, when I submit an
  utterance in the Slack or Confluence panel, then the submit is ignored (in-progress state shown);
  runs are sequential, never simultaneous — accepted.

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.
> Each FR below applies to BOTH Slack and Confluence unless it names one explicitly.
> Traceability: every FR cites the request item (R1–R7) it derives from.

### Render targets & routing

| ID | Requirement |
|----|-------------|
| FR-001 | (R1) `UiRenderTarget` (`src/shared/ipc.ts`) MUST be extended from `'jira' \| 'generated-ui'` to also include **`'slack'`** and **`'confluence'`**. The existing `'jira'`/`'generated-ui'` members, `DEFAULT_UI_RENDER_TARGET`, and the `target` fields on `UiRenderPayload` / `AgentSubmitPayload` MUST be reused unchanged — NO new IPC channel set is added. |
| FR-002 | (R4) The Slack panel MUST host its OWN `A2UIProvider` with the Slack custom catalog and filter incoming `ui:render` to `target: 'slack'`; the Confluence panel MUST host its OWN `A2UIProvider` with the Confluence custom catalog and filter incoming `ui:render` to `target: 'confluence'`. Each panel renders ONLY frames addressed to it and ignores the rest (the existing multi-panel `target`-filter pattern, §4.4). |
| FR-003 | (R4) A Slack-panel utterance MUST drive a render that lands in the **Slack panel body**; a Confluence-panel utterance MUST land in the **Confluence panel body**. A Slack render MUST NOT be misrouted to Confluence/Jira/Generated-UI, and vice versa (the `target` discriminator of FR-001/FR-002 governs both the render push and the composing run). |

### Per-panel custom catalog

| ID | Requirement |
|----|-------------|
| FR-004 | (R2) A **Slack custom A2UI catalog** (`catalogId: 'slack'`, e.g. `src/renderer/slackCatalog/`) MUST be defined and registered via the Slack panel's `A2UIProvider catalog=` prop. Its component vocabulary MUST be built from the existing Slack resource shapes in `src/shared/slack.ts` and MUST cover at least: a **channel list / channel row** (`SlackChannel`: id, name, isMember), a **message row / message list** (`SlackMessage`: author display name with raw-id fallback, text, timestamp, reply count), a **search-result row** (`SlackSearchMatch`: author, text, channel context), and a **Notice** block (for not-connected/error/empty). It MAY reuse the SDK standard `Column`/`Row`/`Text` passthroughs as the Jira catalog does. Every component MUST trace to a real Slack read surface — none invented. |
| FR-005 | (R2) A **Confluence custom A2UI catalog** (`catalogId: 'confluence'`, e.g. `src/renderer/confluenceCatalog/`) MUST be defined and registered via the Confluence panel's `A2UIProvider catalog=` prop. Its component vocabulary MUST be built from the existing Confluence resource shapes in `src/shared/confluence.ts` and MUST cover at least: a **search-result row / list** (`ConfluenceSearchResult`: title, space, excerpt), a **page-detail** view (`ConfluencePageDetail`: title, space, body), and a **Notice** block (for not-connected/error/empty). It MAY reuse the SDK standard `Column`/`Row`/`Text` passthroughs. Every component MUST trace to a real Confluence read surface — none invented. |
| FR-006 | (R2) The custom-catalog components MUST consume the resource shapes already in `src/shared/slack.ts` / `src/shared/confluence.ts` as their data inputs; NO parallel/duplicate Slack or Confluence resource type may be introduced for rendering. |
| FR-007 | (R6/R2) An unknown/invalid component named by a surface MUST degrade to the panel's surface error boundary (a safe fallback, mirroring `JiraPanel`/`GeneratedUiPanel`), never a white-screen. |

### Scoped render tools & tool grants

| ID | Requirement |
|----|-------------|
| FR-008 | (R1) A **Slack-scoped render MCP server** (e.g. `src/mcp/slackRenderUiServer.ts`) MUST be added as a sibling to `jiraRenderUiServer.ts`, exposing one tool (e.g. `render_slack_ui`) that teaches the `catalogId: 'slack'` component vocabulary and relays to the SAME `UiBridge` socket, stamping its bridge frame **`target: 'slack'`**. A **Confluence-scoped render MCP server** (e.g. `src/mcp/confluenceRenderUiServer.ts`) MUST likewise expose one tool (e.g. `render_confluence_ui`) teaching the `catalogId: 'confluence'` vocabulary and stamping **`target: 'confluence'`**. Neither carries any token/secret. |
| FR-009 | (R1) `mcpConfig.ts` MUST add, per new target, a `renderMcpConfigJsonForTarget` branch and an `allowedToolForTarget` grant. The grant for `target: 'slack'` MUST be the Slack render tool **PLUS the existing read-only Slack MCP tools** (`slack_list_channels`, `slack_read_history`, `slack_read_thread`, `slack_search_messages`, `slack_lookup_user` — `SlackTool` in `src/shared/slack.ts`). The grant for `target: 'confluence'` MUST be the Confluence render tool **PLUS the existing read-only Confluence MCP tools** (`confluence_search_content`, `confluence_get_page` — `ConfluenceTool` in `src/shared/confluence.ts`). |
| FR-010 | (R1) **Least privilege:** a `target: 'slack'` run MUST be granted ONLY Slack's render + read tools — it MUST NOT reach Confluence, Jira, or the generic `render_ui` tools. A `target: 'confluence'` run MUST be granted ONLY Confluence's render + read tools — it MUST NOT reach Slack, Jira, or the generic render tools. (Symmetric with the existing Jira grant in `mcpConfig.ts`.) |
| FR-011 | (R5) `groundingPromptForTarget` MUST return a per-target grounding system prompt for `'slack'` and `'confluence'` that forbids fabrication exactly as the Jira one does: the run MUST fetch REAL data with the read tools FIRST; every value rendered MUST come verbatim from a tool result in that run; the render tool's example values MUST NOT be copied; and on not-connected / read error the run MUST render a single **Notice** (pointing the user to connect/reconnect in cosmos) INSTEAD of inventing data. |

### Read-only — no writes (resolved)

| ID | Requirement |
|----|-------------|
| FR-012 | (R3) **Resolved decision — read-only.** Unlike Jira, this feature MUST NOT add any write scope, write MCP tool, deterministic write-action dispatcher (no Slack/Confluence equivalent of `JiraActionDispatcher`), or reserved write-action namespace. The "optional deterministic action dispatch" from the original request is **OMITTED in v1**. The Slack/Confluence generative surfaces are **display-only**: they mirror Jira's *grounding + render + display* path with the write tools and the dispatcher OMITTED. An interactive control that triggers a write is a future cycle, out of scope here. |

### Headless run, spinner correctness, panel chrome

| ID | Requirement |
|----|-------------|
| FR-013 | (R4) Each panel's prompt composer MUST thread its `target` on submit (`window.cosmos.agent.submit({ utterance, target: 'slack' \| 'confluence' })`) and MUST reuse the single existing `AgentRunner` (`run(utterance, target)`) — NO second runner. The existing **single-run / blocked-while-running guard** MUST be kept: a submit while ANY run is in flight is ignored (in-progress state shown). Runs across all panels are sequential — accepted. |
| FR-014 | (R6) **Spinner correctness.** A `'slack'` or `'confluence'` render MUST be settled IMMEDIATELY in `UiBridge` (the display-only pattern Jira uses), so the one-shot headless run completes and the composer's spinner stops. The `UiBridge` branch that currently settles only `target === 'jira'` MUST be generalized to settle ALL non-`'generated-ui'` display-only targets (`'jira'`, `'slack'`, `'confluence'`); only `'generated-ui'` renders keep blocking awaiting a user action. The surface stays rendered (driven by the `pushRender`), independent of the settled call. |
| FR-015 | (R4) Each panel MUST keep its existing connect / not-connected / reconnect affordance unchanged. When NOT connected (or reconnect needed), the panel MUST show that affordance and the prompt composer MUST NOT be usable (no run can start). When connected, the composer MUST be present and usable. The composer's structure MUST mirror `JiraPanel`'s `PromptComposer` (Enter submits, Shift+Enter newlines, empty/whitespace starts no run, in-progress + error states). |
| FR-016 | (R4) The connected body MUST mirror `JiraPanel`'s `ConnectedBody`: an A2UI host (`A2UIProvider` + a `SurfaceBridge` filtering `ui:render` by `target`) plus the bottom-docked composer. Unlike Jira, there is **no per-switch default-view** read for Slack/Confluence in v1 (Jira's `requestDefaultView` has no analogue here — out of scope); the panel starts at an idle/empty state until the first utterance composes a surface. |

### Build wiring & security

| ID | Requirement |
|----|-------------|
| FR-017 | (R7) Each new `src/mcp/<name>.ts` render entry MUST have a matching rollup `input` in `electron.vite.config.ts` (e.g. `'mcp/slackRenderUiServer'`, `'mcp/confluenceRenderUiServer'`) so it builds to `out/main/mcp/<name>.js` — the path `mcpConfig.ts` registers. Without the input the server silently never bundles (known gotcha). |
| FR-018 | (Security, non-negotiable) Slack/Confluence/Atlassian tokens, refresh tokens, and the Atlassian `client_secret` MUST remain main-process only (safeStorage-encrypted), never logged, and never placed in any IPC payload, bridge frame, MCP tool argument/result, or A2UI surface. The read tools relay *operations* over their existing bridges to main, which attaches the credential. The new render tools and catalogs carry only non-secret content/identifiers. v1 adds NO new scope and NO secret-bearing field on any type or surface. |

---

## Edge Cases & Constraints

- **Panel open while not connected** → existing Connect/Reconnect affordance; composer not usable; no
  run can start (FR-015).
- **Not-connected mid-run / read tool returns not_connected or reconnect_needed** → the grounding
  prompt makes the agent render a single Notice pointing to connect/reconnect, never fabricated data
  (FR-011). The native panel status (`onStatusChanged`) still reflects reconnect-needed independently.
- **Read returns an error (rate_limited / network)** → the agent renders a Notice explaining the
  failure rather than inventing data (FR-011); never a crash, hang, or stack trace.
- **Empty results** (no channels, no search hits, page not found) → the surface conveys "nothing
  found"; no placeholder rows invented (FR-011, "Surfaces are built from REAL data only" scenario).
- **Fabrication guard** → grounding prompt forbids copying the render tool's example values or
  inventing any channel/message/user/space/page; values must be verbatim from a tool result (FR-011).
- **Concurrent runs (any two panels)** → the single shared `AgentRunner`'s single-run guard makes
  them sequential (FR-013); a submit while busy is ignored (in-progress shown); no crash/hang/lost
  intent. A Slack utterance and a Confluence/Jira/generic utterance cannot run simultaneously —
  accepted.
- **Spinner never stops** → prevented by settling `'slack'`/`'confluence'` renders immediately in
  `UiBridge` (FR-014); a read-only surface emits no action, so without this the one-shot run blocks
  forever and the spinner hangs.
- **Render misrouting** → the `target` discriminator (FR-001/FR-002/FR-003) guarantees each panel
  renders only its own frames; an unknown/invalid component degrades to the panel's error boundary
  (FR-007), never a white-screen.
- **Reload / teardown** → on renderer reload or app teardown, `UiBridge` resolves the active call
  exactly once (existing behavior); a display-only Slack/Confluence call is already settled at push
  time (FR-014), so teardown has nothing dangling for it. Panels are kept mounted across rail switches
  (App shell forceMount), so a surface rendered while away is present on return.
- **Explicitly out of scope for v1:**
  - Any write to Slack or Confluence (post/edit/react; create/edit pages) and any new OAuth scope.
  - Any deterministic write-action dispatcher / reserved write-action namespace (the Jira
    `JiraActionDispatcher` / `jira.*` analogue) — OMITTED (FR-012).
  - A per-switch default view for Slack/Confluence (no `requestDefaultView` analogue) — OMITTED (FR-016).
  - The exact visual design (pixels/tokens) of the new catalog components — owned by the later
    `design` step (the `designer` agent), not this spec.
  - Changing Jira's or the generic Generated-UI panel's behavior.
  - New read capabilities beyond the existing Slack/Confluence read tools (the agent composes from
    today's reads only).

---

## Success Criteria

| ID | Criterion |
|----|-----------|
| SC-001 | Submitting an utterance in the Slack panel re-composes its body into the requested Slack surface via the Slack-scoped render tool (`target: 'slack'`), rendered in the Slack panel with the `catalogId: 'slack'` custom catalog, from `src/shared/slack.ts` shapes; the same holds for Confluence with `target: 'confluence'` and `src/shared/confluence.ts`. |
| SC-002 | Every value in a composed Slack/Confluence surface traces to a read-tool result in that run; a not-connected/error/empty read yields a Notice (or "nothing found"), never fabricated data. |
| SC-003 | A `target: 'slack'` run is granted ONLY Slack's render + read tools (and likewise Confluence) — it cannot reach the other integrations' tools or the generic render tool (least privilege, verifiable from `mcpConfig.ts`). |
| SC-004 | After a Slack or Confluence run renders a surface, the composer's in-progress spinner stops (the render is settled immediately in `UiBridge`); the run never hangs awaiting an action a read-only surface cannot produce. |
| SC-005 | A Slack/Confluence render is never misrouted to another panel (each panel filters `ui:render` by `target`); an unknown/invalid component degrades to the panel's error boundary, never a white-screen. |
| SC-006 | Each panel still shows its Connect/Reconnect affordance when not connected and disables the composer there; when connected the composer is usable. Jira's and the Generated-UI panel's behavior are unchanged. |
| SC-007 | No write scope, write tool, or write-action dispatcher is added; tokens and the Atlassian `client_secret` remain main-process only across all v1 paths (never logged/IPC/bridge/MCP/surface); v1 adds no new scope and no secret-bearing field. |
| SC-008 | Each new render entry script has a matching rollup `input` in `electron.vite.config.ts` and builds to `out/main/mcp/<name>.js`; the build and typecheck are green. |

---

## Open Questions

- None blocking. All scope decisions from the request (R1–R7) are resolved in the FRs above; the
  read-only decision (FR-012) and the single-combined-spec choice are explicitly recorded. The exact
  visual design of the new catalog components is deferred to the `design` step by intent, not left
  ambiguous here.

---

## System-shape decisions to surface at wrap-up

Two new render targets (`'slack'`, `'confluence'`) extend the target-routed multi-panel A2UI model
(§4.3/§4.4); two new scoped render tools + custom catalogs join the registry (§4.7); the `UiBridge`
display-only settle generalizes from "jira" to "all non-generated-ui targets" (§4.3). Reflect these in
`docs/ARCHITECTURE.md` (esp. §3 diagram's render entry scripts, §4.3, §4.4, §4.7, §4.8/§4.9 panel
descriptions, §4.10 per-target grant table, and §5a) at wrap-up so the doc stays authoritative.
