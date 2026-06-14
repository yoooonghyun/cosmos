# Spec: Bindings-First Generative UI — v1

**Status**: Draft
**Created**: 2026-06-14
**Supersedes**: the "author the `{path}` bindings yourself / do NOT pass literal rows" teaching of `refreshable-custom-generative-ui-v1` (its FR-004 and tool-description guidance), now incorrect under main's `rebindAgentSurface`. Reuses all of that feature's built mechanism unchanged.
**Related plan**: `.sdd/plans/bindings-first-generative-ui-v1.md`

---

## Grounding

Investigation run directly for this spec (mandatory report):

**codegraph_explore**
- `rebindAgentSurface specRebinder planRegions registerAgentSurfaceBindings uiBridge onMessage adapterBindingRegistry LIST_SOURCE_DATA_PROP` — confirmed the mechanism is fully built and intact: `rebindAgentSurface(spec, bindings)` (`src/main/specRebinder.ts`) finds each binding's container by `componentId`, OVERWRITES its rows prop to a region-scoped `{path}` regardless of whether the agent passed a literal array OR an existing `{path}`, SEEDS the agent's literal rows as the first page (`seedRows = isPathBinding(literal) ? [] : Array.isArray(literal) ? literal : []`), stamps `region` on multi-region containers, and rewrites `loading`/`hasMore`/`error` to region paths. `planRegions`: regionKey = `componentId` when >1 binding, `''` when single. `uiBridge.onMessage` runs the bindings path with PRECEDENCE over `descriptor` (`if (bindings === undefined && message.descriptor !== undefined)`), registers each region, kicks first refresh, pushes rebound spec + seed data model. `LIST_SOURCE_DATA_PROP` (`src/main/adapterBindingRegistry.ts`) maps each list `dataSource` → its rows prop (`searchIssues`→`issues`, `listChannels`→`channels`, `getHistory`→`messages`, `search`→`matches`, `searchContent`/`defaultFeed`→`results`), extensible one-entry-per-source.

**Reads** (the actual gap — the four tool descriptions)
- `src/mcp/jiraRenderUiServer.ts` — `JIRA_TOOL_DESCRIPTION` step "2) Bind the data-driven props to data-model PATHS with `{ "path": "/..." }` — do NOT pass the fetched rows as literal/static props (literals can NEVER repaint)" and the partitioned step "2) Bind each container's list prop to its REGION path … Do NOT pass literal rows (they can never repaint)." Both now WRONG.
- `src/mcp/slackRenderUiServer.ts` — `SLACK_TOOL_DESCRIPTION`: "bind the list props to these data-model PATHS … (NOT literal/static values)" and "Any prop left as a literal will NOT change on refresh." Now wrong.
- `src/mcp/confluenceRenderUiServer.ts` — `CONFLUENCE_TOOL_DESCRIPTION`: same "bind the data-driven props … (NOT literal/static values)" / "Any prop left as a literal will NOT change on refresh." Now wrong.
- `src/mcp/renderUiServer.ts` — `A2UI_TOOL_DESCRIPTION`: "Bind the data-driven props (NOT literals) to the data-model PATH that dataSource implies" and the partitioned "Bind each container's data prop to its REGION path … never both." Now wrong.

**memory_recall / memory_smart_search**
- `bindings-first generative UI refresh data fetcher rebind agent surface literal rows seed` — no prior hits.
- `MCP render server tool description literal rows path binding agent compose generative UI` — no prior hits.
- Persisted this cycle's decision via `memory_save` (the mechanism is built; the gap is the four tool descriptions teaching an outdated model).

**ARCHITECTURE.md** — section "Multi-region refreshable surfaces" already documents the built rebind/seed mechanism verbatim; the architecture doc is already correct, only the tool descriptions drifted from it.

---

## Overview

Every data-displaying surface the agent generates (Jira, Slack, Confluence, and the generic
Generated-UI panel) must be refreshable, and the agent must be taught to compose its layout from
BINDINGS — one declared fetcher per data-bearing container — rather than from the literal rows it
just fetched. Main already rewrites each bound container's data prop to a refreshable `{path}` and
treats the agent's literal rows as a first-paint seed; this feature aligns the four MCP render-tool
descriptions with that reality so the agent stops being told to hand-author `{path}` bindings and
to withhold literal rows.

## Background — the teaching gap being fixed

The runtime mechanism is already built and intact end-to-end (`refreshable-custom-generative-ui-v1`
multi-region, documented in `docs/ARCHITECTURE.md` → "Multi-region refreshable surfaces"):

- `src/main/specRebinder.ts` `rebindAgentSurface(spec, bindings)` finds each binding's container by
  `componentId` and OVERWRITES that container's rows prop to a region-scoped `{path}` binding —
  whether the agent passed a literal array or an existing `{path}` — and rewrites `loading`/`hasMore`/
  `error` to region paths, stamping `region` on multi-region containers. It SEEDS the agent's literal
  rows as that region's first page so the surface paints instantly before the first refresh.
- `src/main/uiBridge.ts` `onMessage` runs the `bindings` path with precedence over `descriptor`,
  registers each region with the dispatcher, kicks each region's first refresh, and pushes the rebound
  spec plus the seed data model.
- `src/main/adapterBindingRegistry.ts` `LIST_SOURCE_DATA_PROP` / `listSourceBinding(dataSource)` is the
  single, extensible map of which prop a list container reads its rows from.

So an agent that passes literal rows in a declared binding gets a fully refreshable surface today. But
the four render-tool descriptions still teach the OLD `refreshable-custom-generative-ui-v1` model:
they instruct the agent to "bind the data-driven props to PATHS yourself (NOT literals)" and warn
"do NOT pass literal rows (they can never repaint)" / "any prop left as a literal will NOT change on
refresh." Under `rebindAgentSurface` those instructions are incorrect: the agent does NOT author the
`{path}`, main does; literal rows ARE a valid seed; what actually makes a container refreshable is
declaring a `binding` for it, not the prop's literal-vs-`{path}` shape. The descriptions must be
reframed BINDINGS-FIRST so the agent's mental model matches the mechanism.

## Chosen direction (committed)

Reframe the four tool descriptions around a single bindings-first mental model, with NO change to the
built runtime mechanism (rebind, seed, dispatcher, validation, secret handling all stay as-is):

1. The agent COMPOSES the layout it wants (a list, a kanban, a detail, side-by-side feeds) and may
   pass the rows it just fetched as ordinary literal props — those become the first-paint seed.
2. For EACH data-bearing container the agent declares ONE binding (its `dataSource` + non-secret
   `query`) so main can re-fetch and repaint it. A surface with a single data container declares one
   binding; a partitioned layout (kanban columns, side-by-side feeds) declares one per container.
3. `descriptor` is retained and re-described as the degenerate single-binding form (one surface-wide
   fetcher), but `bindings` is the primary vocabulary. Bindings wins when both are present (existing
   precedence).
4. The incorrect "author `{path}` yourself / do NOT pass literal rows / literals can never repaint"
   instructions are removed from all four descriptions.

This is primarily MCP-tool-description text work. The only candidate behavioral change is an OPTIONAL
main-side dev warning when a data-bearing surface is composed with NO binding (FR-008) — see Edge
Cases; it is scoped as SHOULD and must not alter what renders.

**Design step (designer / `design` skill) is SKIPPED:** this feature adds no renderer UI, no theme
tokens, and no `src/renderer/components/ui/` work — it changes MCP tool-description strings and (at
most) a main-side warning log. Per CLAUDE.md, the design step is for visual surfaces only.

---

## User Scenarios

### Compose a refreshable list by passing fetched rows + one binding · P1

**As a** cosmos user who asks the agent for a Slack channel list / Jira issue list / Confluence feed
**I want to** see the list paint immediately and then refresh it with the panel refresh control
**So that** the generated view stays live without re-asking the agent

**Acceptance criteria:**

- Given the agent fetched rows and composed a list container, when it passes those rows as a literal
  prop AND declares one binding for that container, then the surface paints the seeded rows
  immediately and the panel refresh control is ENABLED for that tab.
- Given that surface is active, when the user clicks refresh, then main re-fetches the binding's
  `dataSource`/`query` (token attached only in main) and the same container repaints with fresh data,
  with no agent round-trip and no layout re-composition.
- Given the tool description the agent read, then it was instructed to declare a binding per data
  container and that literal rows are an accepted seed — it was NOT instructed to hand-author `{path}`
  bindings or to withhold literal rows.

### Compose a refreshable partitioned board with one binding per container · P1

**As a** user who asks for a Jira kanban (one column per status) or side-by-side Slack/Confluence feeds
**I want to** each container to refresh independently with its own slice
**So that** an empty column still refreshes and can receive items that move into it

**Acceptance criteria:**

- Given the agent composes several data-bearing containers and declares one binding per container (each
  with its own narrowed `query`), when the surface lands, then every container paints its seeded rows
  and each refreshes independently against its own binding.
- Given a column the agent composed with an EMPTY literal rows array but a declared binding, when
  refreshed, then that column re-fetches via its binding and can populate — its identity comes from its
  binding's query, not from the seeded rows.

### Every data surface is refreshable across all four render tools · P1

**As a** user generating UI in any of the Jira, Slack, Confluence, or Generated-UI panels
**I want to** every data-displaying generated surface to be refreshable
**So that** refreshability is uniform regardless of which integration produced the surface

**Acceptance criteria:**

- Given each of `render_jira_ui`, `render_slack_ui`, `render_confluence_ui`, and `render_ui`, then its
  tool description teaches the SAME bindings-first model: compose the layout, declare a binding per
  data container, literal rows are an accepted seed.
- Given a data-displaying surface composed via any of the four tools with a binding per data container,
  when rendered, then it is refreshable (control enabled, refresh repaints in place).

### A static surface with no live data declares no binding · P2

**As a** the agent composing a purely static/composed surface (no live integration data)
**I want to** declare no binding and have the surface render normally
**So that** non-data surfaces are not forced into a refresh contract

**Acceptance criteria:**

- Given a surface that shows no live integration data, when the agent declares no binding, then the
  surface renders un-refreshably (refresh control disabled) and nothing warns — unchanged behavior.

---

## Functional Requirements

> "MUST"/"SHOULD"/"MAY" per template. Every FR traces to the directive ("every data surface
> refreshable" + "compose from bindings, not fetched literal data") or to a non-negotiable constraint.

| ID     | Requirement |
|--------|-------------|
| FR-001 | All four render-tool descriptions (`render_jira_ui`, `render_slack_ui`, `render_confluence_ui`, `render_ui`) MUST teach a BINDINGS-FIRST model: the agent composes the layout and declares one `binding` (its `dataSource` + non-secret `query`) per data-bearing container, so EVERY data-displaying generated surface can be refreshed. |
| FR-002 | The descriptions MUST state that the agent MAY pass the rows it just fetched as ordinary literal props and that those literal rows become the first-paint SEED — main rewrites each bound container's data prop to a refreshable binding regardless of whether the agent passed literals or a `{path}`. |
| FR-003 | The descriptions MUST REMOVE the now-incorrect instructions that the agent should hand-author `{path}` bindings for data props, and that literal/fetched rows "can never repaint" / "will NOT change on refresh." No description may instruct the agent to author the refresh `{path}` itself. |
| FR-004 | The descriptions MUST present `bindings` (one entry per data container, `{ componentId, descriptor }`) as the PRIMARY way to make data containers refreshable, covering both the single-container case (one binding) and the partitioned case (one binding per column/feed). `descriptor` MUST be retained and re-described as the degenerate single-binding form (one surface-wide fetcher); the descriptions MUST keep the existing "never pass both" guidance and note bindings takes precedence. |
| FR-005 | The bindings-first reframing MUST be UNIFORM across the four tools, differing only in each catalog's component/type names, `dataSource` values, and rows-prop names — the model and seeding semantics are identical (Jira, Slack, Confluence, generic). |
| FR-006 | The descriptions MUST keep the secret-free contract explicit: `query` carries only non-secret params (e.g. `jql`, `channelId`, `pageId`, search `query`) and NEVER a token; the token is attached only in main at refresh. (Reaffirms the existing constraint; no behavior change.) |
| FR-007 | The reframing MUST NOT change the built runtime mechanism: `rebindAgentSurface`/`planRegions`, `uiBridge.onMessage` bindings-over-descriptor precedence, `registerAgentSurfaceBindings`, the AdapterDispatcher registration/refresh/pagination, `validateAdapterBindings`/`validateAdapterDescriptor` boundary validation + secret-stripping, and the seed-after-render ordering all remain unchanged. |
| FR-008 | The system SHOULD emit a main-side DEV WARNING (warn-and-continue, never crash, never alter what renders) when a rendered surface appears to be data-bearing but carries NO usable binding/descriptor — so an unbound data surface is caught during development. This MUST be detectable from information main already has at the `UiBridge` boundary (e.g. a frame with neither `bindings` nor `descriptor` whose spec contains a known list container type/rows prop); if it cannot be determined without new spec inspection beyond what main already does, this requirement is descoped to a tool-description-only reminder (see Open Questions OQ-1). |
| FR-009 | If FR-008's warning is implemented, the detection MUST be heuristic and side-effect-free: it MUST NOT block, modify, or fail the render; an ambiguous case MUST err toward NOT warning (no false-positive noise on legitimate static surfaces). |
| FR-010 | The change MUST NOT introduce any new IPC channel, payload field, or alter the typed IPC/bridge contract in `src/shared/ipc.ts` / `src/shared/bridge.ts`; the existing `descriptor`/`bindings` frame fields are reused as-is. (A descoped FR-008 implies no contract change at all.) |

## Edge Cases & Constraints

- **Agent passes literal rows in a declared binding.** This is now the EXPECTED, correct path: main
  seeds the literals and rebinds the prop, so the surface paints instantly and refreshes. The
  descriptions must present this as normal, not as a mistake.
- **Agent passes an existing `{path}` in a declared binding.** Still valid: `rebindAgentSurface`
  overwrites the prop to its region path and seeds `[]` (no literal to seed); the first refresh fills
  it. Descriptions need not forbid `{path}`, but should stop REQUIRING the agent to author it.
- **Data-bearing surface composed with NO binding.** The surface renders but is not refreshable. This
  is the directive's failure mode ("EVERY data surface must be refreshable"). Addressed by the
  bindings-first teaching (FR-001) and, if in scope, the dev warning (FR-008/FR-009). It is NOT a
  crash and the surface still renders.
- **Unknown / non-list `dataSource` in a binding.** Existing behavior unchanged: `planRegions` /
  `listSourceBinding` drops it (warned) and the container renders un-refreshably (its seeded literals
  still show). The descriptions should continue to list the valid `dataSource` values per catalog.
- **Partitioned layout where a container id in `bindings` matches no component.** Existing behavior
  unchanged: `rebindAgentSurface` warns and skips that region.
- **Out of scope:**
  - Any change to the rebind/seed/dispatcher/validation runtime mechanism (FR-007) — descriptions only,
    plus at most the FR-008 warning.
  - New renderer UI, theme tokens, or `src/renderer/components/ui/` work (design step skipped).
  - Inspecting the agent's spec to AUTO-bind containers the agent forgot to declare (out of scope; the
    agent declares bindings — FR-008 only WARNS, it does not auto-fix).
  - Adding new `dataSource` values or new rebindable list sources.
  - Any change to the token/secret model.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | All four tool descriptions teach the same bindings-first model: "compose the layout, declare one binding per data container, literal rows are an accepted seed" — verified by reading each description string. |
| SC-002 | No tool description contains an instruction to hand-author `{path}` data-prop bindings, nor a claim that literal/fetched rows "can never repaint" / "will NOT change on refresh" (FR-003) — verified by absence in each string. |
| SC-003 | An agent that follows the new descriptions (passes fetched rows literally + declares one binding per data container) produces a surface that paints the seed immediately and is refreshable (control enabled, refresh repaints in place) — across Jira, Slack, Confluence, and the generic panel. |
| SC-004 | The built runtime mechanism is unchanged: existing tests for `rebindAgentSurface`, `uiBridge`, and validation still pass with no source change to those modules (FR-007). |
| SC-005 | No token/secret appears in any binding/descriptor, MCP result, bridge frame, IPC payload, or surface (existing boundary validation unchanged; FR-006). |
| SC-006 | If FR-008 is implemented: composing a data-bearing surface with no binding emits exactly one dev warning and still renders the surface; a legitimate static surface emits no warning (no false positive). If descoped: the descriptions carry an explicit reminder that data containers need a binding to be refreshable. |

---

## Open Questions

- [ ] **OQ-1 — Scope of the no-binding dev warning (FR-008/FR-009).** Can main reliably tell, at the
  `UiBridge` boundary, that a surface with neither `bindings` nor `descriptor` is "data-bearing"
  WITHOUT new, heavier spec inspection — e.g. by checking the spec for a known list container
  type or a known rows prop (`issues`/`channels`/`messages`/`matches`/`results`)? If yes, implement
  the warning as a side-effect-free heuristic (warn-and-continue). If the heuristic would be noisy or
  require inspection beyond what main already does, DESCOPE FR-008 to a tool-description-only reminder
  (FR-001–FR-006) and resolve this as "descriptions-only." This is the single decision the plan must
  settle; it does not block the core descriptions-first work.
