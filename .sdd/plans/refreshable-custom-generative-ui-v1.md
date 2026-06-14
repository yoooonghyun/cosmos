# Plan: Refreshable Custom Generative UI — v1

**Status**: Draft
**Created**: 2026-06-13
**Last updated**: 2026-06-13
**Spec**: `.sdd/specs/refreshable-custom-generative-ui-v1.md`

---

## Summary

Make an agent-composed CUSTOM generative-UI surface refreshable in place. Today, when the agent
attaches a secret-free `{ dataSource, query }` descriptor to its `render_*_ui` frame, `UiBridge`
replaces the agent's spec with a FIXED generic `{path}`-bound SHELL (via `resolveDescriptorShell`)
and registers the SHELL's surfaceId — discarding the custom layout. This change flips that: main
registers the descriptor under the AGENT's OWN `spec.surfaceId` using the bind options the
`dataSource` implies (reusing the per-integration bind-option resolvers), kicks the first refresh,
and pushes the AGENT's spec AS-IS. The generic shell becomes the FALLBACK only when the agent's spec
is structurally unusable. The render-tool descriptions are extended to teach the agent the documented
per-`dataSource` data-model paths (`/items`, `/issue`, `/channels`, `/messages`, `/matches`, `/feed`,
`/results`, `/page`, + reserved `/loading`, `/hasMore`, `/error`) so its `{path}` bindings line up
with what the dispatcher pushes. The session snapshot persists the agent's verbatim bound spec beside
the descriptor; `SESSION_SCHEMA_VERSION` bumps 3 → 4. No token/secret model changes — the token is
attached only in main at refresh.

## Technical Context

| Item              | Value |
|-------------------|-------|
| Language          | TypeScript (Electron main + renderer + MCP entry scripts) |
| Key dependencies  | Existing: `AdapterDispatcher`, `validateAdapterDescriptor`, `resolveDescriptorShell`, per-integration `*BindOptionsForSource` / `jira*BindOptions`, `derivePanelRefreshState`, `ActiveTabSurface`, `useGenerativePanelTabs`, session snapshot. No new packages. |
| Files to create   | `src/main/descriptorRegistration.ts` (pure: resolve bind options for an agent surfaceId from a descriptor — or keep this inline if trivial). Optional; may fold into `descriptorShell.ts`. |
| Files to modify    | `src/main/uiBridge.ts`, `src/main/index.ts`, `src/main/descriptorShell.ts` (or sibling), `src/mcp/renderUiServer.ts`, `src/mcp/jiraRenderUiServer.ts`, `src/mcp/slackRenderUiServer.ts`, `src/mcp/confluenceRenderUiServer.ts`, `src/shared/ipc.ts` (`SESSION_SCHEMA_VERSION`), `src/renderer/useGenerativePanelTabs.ts` + session persist/hydrate (`buildGenerativePanel`/`hydrateGenerativeTabs`), `docs/ARCHITECTURE.md`. |

### Key design decisions

1. **Register under the agent's surfaceId, not the shell's.** `UiBridge.registerDescriptor` (and the
   `index.ts` closure wiring it) change to receive the agent's `spec` and register the descriptor
   under `spec.surfaceId`. The bind options come from a NEW pure resolver
   `resolveBindOptionsForSource(dataSource)` that returns the same `{ listPath, pagination }` the
   generic shells use, WITHOUT building a shell spec — split out of `resolveDescriptorShell` so the
   options half is reusable independently. The shell-building half stays for the fallback (FR-006).

2. **Fallback to the generic shell only for an unusable spec.** Main checks the agent's spec is
   usable (non-empty `surfaceId` + `components` is an array). Usable → register the agent's surface +
   push it. Unusable → `resolveDescriptorShell` → register + push the shell (today's behavior).
   `validateSurfaceUpdate` already exists at the MCP boundary; main re-checks the minimal shape here.

3. **Bridge contract unchanged in shape.** `BridgeRenderRequest` already carries `spec` + optional
   `descriptor`. `UiBridge.registerDescriptor` signature changes from
   `(descriptor, target) => spec | null` to one that also takes the agent's spec and returns whether
   it registered the agent surface (so `onMessage` knows whether to keep the agent spec or swap in a
   shell). Concretely: `registerAgentSurface(descriptor, agentSpec, target) => A2uiSurfaceUpdate`
   (returns the spec to push: the agent's when registered under its id, the shell's on fallback, or
   the agent's unchanged when no registration happened).

4. **Documented path contract single-sourced.** The per-`dataSource` paths in the tool descriptions
   come from the SAME constants the resolvers/builders use (`JIRA_LIST_PATH`/`JIRA_DETAIL_PATH`,
   `SLACK_*_PATH`, `CONFLUENCE_*_PATH`). Prefer importing/centralizing the human-readable mapping so
   the description text and the dispatcher cannot drift (a small exported `dataSourcePathDoc` map per
   integration, or interpolate the constants into the description string).

5. **Session schema bump 3 → 4.** Persisting the agent's verbatim bound spec + descriptor under the
   "register-agent-surface" rule changes what a descriptor-bearing persisted surface MEANS. A v3
   snapshot (written under the shell-replacement rule) could pair a descriptor with a spec that the
   new code would wrongly treat as the agent's own bound layout. Bump invalidates v3 → clean session.

---

## Implementation Checklist

### Phase 1 — Interface

- [ ] Read the spec; confirm no open questions remain (none blocking).
- [ ] In `src/main/descriptorShell.ts` (or a sibling pure module): split out
      `resolveBindOptionsForSource(dataSource): AdapterRegisterOptions | null` from
      `resolveDescriptorShell`, reusing `slackBindOptionsForSource`/`confluenceBindOptionsForSource`/
      `jiraListBindOptions`/`jiraDetailBindOptions` (the SAME source-of-truth — FR-002). Keep
      `resolveDescriptorShell` for the fallback (FR-006).
- [ ] In `src/main/uiBridge.ts`: change the `registerDescriptor` dep to a
      `registerAgentSurface(descriptor, agentSpec, target): A2uiSurfaceUpdate` (or keep the name,
      widen the signature) that returns the spec to push. Update `onMessage` to call it with
      `message.spec` and push the returned spec.
- [ ] In `src/shared/ipc.ts`: bump `SESSION_SCHEMA_VERSION` 3 → 4 with a comment explaining the
      register-agent-surface meaning change (FR-013).
- [ ] Confirm `GenerativeTabSnapshot` already persists `surface.spec` + `descriptor` (it does) — no
      new field needed; the change is the bump + that the persisted spec is now the agent's CUSTOM
      bound spec (FR-010).
- [ ] Review types vs spec — no invented properties; descriptor stays `{ dataSource, query }`.

### Phase 2 — Testing

- [ ] `descriptorShell` / bind-options test: `resolveBindOptionsForSource` returns the right
      `{ listPath, pagination }` for each Jira/Slack/Confluence source and `null` for unknown
      (FR-002/FR-015).
- [ ] `uiBridge` test (node, injected deps): agent attaches a valid descriptor + a USABLE custom spec
      → `registerAgentSurface` called with the agent's spec; the PUSHED `spec.surfaceId` equals the
      agent's, and the descriptor is registered under the agent's surfaceId (FR-001/FR-003), first
      refresh kicked (assert the dispatcher's `register` + `refresh` were called with the agent's id).
- [ ] `uiBridge` test: agent attaches a descriptor but an UNUSABLE spec (no `surfaceId` / no
      `components`) → fallback to the generic shell; pushed spec is the shell's (FR-006).
- [ ] `uiBridge` test: NO descriptor → agent spec pushed unchanged, nothing registered (FR-007).
- [ ] `uiBridge` test: invalid / cross-target / unknown-`dataSource` descriptor → warned + ignored,
      agent's literal spec pushed un-refreshably, no crash (FR-008/FR-015).
- [ ] `validateAdapterDescriptor` test: a secret-looking query key is stripped; no token survives
      (FR-009/SC-004) — extend existing coverage if present.
- [ ] `AdapterDispatcher` test: refresh on a surface registered under an agent surfaceId emits
      `updateDataModel` keyed by THAT surfaceId at the resolved `listPath` (FR-005); a re-register for
      the same id replaces prior state (FR-014).
- [ ] Session store / hydrate test: a v3 snapshot is unreadable after the bump → clean session
      (FR-013/SC-005); a v4 snapshot with a custom bound `composed:true` surface + descriptor
      round-trips (FR-010).
- [ ] `panelRefreshLogic` test: a tab whose surface carries the agent's surfaceId + descriptor is
      ENABLED (FR-012) — confirm existing `derivePanelRefreshState` already covers it (likely no code
      change, just a test asserting the custom-surface case).

### Phase 3 — Implementation

- [ ] `src/main/uiBridge.ts`: implement the register-agent-surface branch; push the agent's spec when
      registered, the shell on fallback, the agent's spec unchanged when no descriptor / unregisterable.
- [ ] `src/main/index.ts`: rewrite the `registerDescriptor`/`registerAgentSurface` closure: resolve
      bind options via `resolveBindOptionsForSource(descriptor.dataSource)`; if options + a usable
      agent spec → `adapterDispatcher.register(agentSpec.surfaceId, descriptor, options)` +
      `void adapterDispatcher.refresh(agentSpec.surfaceId)` + return `agentSpec`; else if a shell
      resolves → register + refresh the shell + return the shell spec; else return the agent spec
      unchanged.
- [ ] `src/main/descriptorShell.ts` (or sibling): add `resolveBindOptionsForSource`; keep
      `resolveDescriptorShell` for fallback.
- [ ] `src/mcp/jiraRenderUiServer.ts`: extend `JIRA_TOOL_DESCRIPTION` to document the `{path}`
      contract: `searchIssues` → bind your list to `/items` (+ `/loading`, `/hasMore`); `getIssue` →
      bind to `/issue` (+ sub-paths, `/loading`, `/error`); instruct `{path}` bindings (not literal
      props) for refreshable data, and to mint a unique `surfaceId`.
- [ ] `src/mcp/slackRenderUiServer.ts`: document `listChannels`→`/channels`, `getHistory`→`/messages`,
      `search`→`/matches` (+ reserved flags), same `{path}` guidance.
- [ ] `src/mcp/confluenceRenderUiServer.ts`: document `defaultFeed`→`/feed`,
      `searchContent`→`/results`, `getPage`→`/page` (+ reserved flags), same guidance.
- [ ] `src/mcp/renderUiServer.ts`: add the generic data-model `{path}` note (the standard catalog
      surface can also bind, when a descriptor is supplied) — keep concise; this server's descriptor
      path is the generic one.
- [ ] Single-source the path strings into the descriptions from the `*_PATH` constants (a small
      exported doc map per integration) so text and dispatcher cannot drift (FR-002/FR-004).
- [ ] `src/renderer/useGenerativePanelTabs.ts` + persist/hydrate helpers: confirm the agent's custom
      bound spec + descriptor persist on a `composed:true` tab and re-instate with `restored:true`
      so ActiveTabSurface fires the restore refresh (FR-011). The restore refresh already carries the
      descriptor + the surfaceId from `surface.spec.surfaceId`; main lazily registers from that.
- [ ] All tests pass; `npm run typecheck` (node + web) green.
- [ ] Reused shared utilities — no duplicated bind-option logic (one source of truth).

### Phase 4 — Docs

- [ ] Update `docs/ARCHITECTURE.md` §4.10/§4.11 / OQ-5 / OQ-4g (panel-refresh-v1 section): describe
      the new "register-agent-surface, don't replace" rule; the documented per-`dataSource`
      data-model path contract; the generic shell as fallback-only; the schema bump 3 → 4. Remove the
      stale "Remaining seam (follow-up `agent-bound-surface-descriptor-v1`)" note now that it is built,
      and the §SESSION_SCHEMA_VERSION rationale in `ipc.ts` comment.
- [ ] Add an OQ entry (4h) marking this cycle built once implemented.
- [ ] Update this plan with deviations; reconcile `TODO.md` via the wrap-up skill.

---

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **2026-06-13**: Plan authored. Key calls: (a) register under the agent's `spec.surfaceId`, with bind
  options from a split-out `resolveBindOptionsForSource`; (b) generic shell as fallback ONLY for a
  structurally-unusable spec — cosmos trusts the documented `{path}` contract rather than statically
  detecting bound-vs-literal specs; (c) `SESSION_SCHEMA_VERSION` bump 3 → 4 (the register-agent-surface
  rule changes the meaning of a persisted descriptor-bearing surface).

- **2026-06-13 (implementation)**: Steps 3-5 done. Deviations / notes:
  - **Renderer needed NO code changes.** The restore-refresh effect (`ActiveTabSurface.tsx`),
    persist/hydrate (`sessionSnapshot.ts` `buildGenerativeTab`/`hydrateGenerativeTabs`), the
    descriptor plumbing in `useGenerativePanelTabs.ts`, and `derivePanelRefreshState` were already
    surfaceId/descriptor-keyed and integration-agnostic, so a custom agent surfaceId flows through
    them unchanged. Added verification-only tests (FR-010 round-trip, FR-012 custom-surface enable).
  - **Decision split into a PURE module** `src/main/descriptorRegistration.ts`
    (`planAgentSurfaceRegistration`) — the plan's optional file — so the register-vs-shell-vs-skip
    rule is node-testable with the REAL resolvers; `index.ts`'s `registerAgentSurface` closure only
    does the `register`+`refresh` side effects. `UiBridge`'s dep renamed `registerDescriptor` →
    `registerAgentSurface(descriptor, agentSpec, target) => { spec, registered }`.
  - **Path single-sourcing:** added `AdapterSourcePath` + `AdapterFlagPath` to `src/shared/adapter.ts`
    (importable by BOTH main adapters AND MCP entry scripts, avoiding a main→mcp layering violation);
    each integration `*_PATH` constant + every render-tool description now references those, so the
    documented path and the dispatcher-registered `listPath` are literally one definition (FR-002).
  - **Jira parity:** added `jiraBindOptionsForSource(dataSource)` to `jiraAdapter.ts` so
    `resolveBindOptionsForSource`/`resolveDescriptorShell` treat all three integrations uniformly
    (Jira previously inlined its source→options choice).
  - `npm run typecheck` + `npm test` (926 tests) both green.
