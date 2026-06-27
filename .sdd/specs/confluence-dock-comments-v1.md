# Spec: Confluence Page Dock — View + Add Comments — v1

**Status**: Draft
**Created**: 2026-06-27
**Supersedes**: none (extends the Confluence page-detail dock: `.sdd/specs/confluence-page-detail-dock-v1.md`, and the comment-write surface: `.sdd/specs/confluence-mcp-write-v1.md` §Comment)
**Related plan**: `.sdd/plans/confluence-dock-comments-v1.md` (to author next)
**Related design (to author next)**: `.sdd/designs/confluence-dock-comments-v1.md` — **UI-bearing**: this feature adds a comments section + a compose affordance to the page dock, so the cycle MUST run the Design step (2.5) before implementation.

---

## Grounding

> Direct investigation run for THIS spec (mandatory handoff). Exact tool queries + one-line takeaways. I ran these myself; nothing here was pre-pasted.

**codegraph_explore (code structure):**

- `ConfluencePanel genUiPage page-detail dock ConfluenceView native-overlay GlassDock` → the page dock is the renderer-local `genUiPage` overlay over `ConfluencePanel` reusing the native `PageDetail` (`src/renderer/confluenceCatalog/components.tsx`), wrapped in `GlassDock`. `ConfluenceView = {kind:'search'} | {kind:'page',pageId,title}`. The dock body is a native component reading `window.cosmos.confluence.getPage` directly. **Takeaway: comments belong INSIDE this dock body, reached via renderer IPC — not the agent.**
- `Confluence MCP server addComment updateContent getComments write:comment:confluence OAuth scopes` → a footer-comment WRITE already ships, but **only as the agent-mediated MCP tool `confluence_create_comment`** (`ConfluenceManager.createComment` → `ConfluenceClient.createComment` → `POST /wiki/api/v2/footer-comments`). **There is NO comment READ method anywhere** (no `getComments` client/manager/IPC).
- `ConfluenceManager createComment getWriteCapability getCommentCapability scopes ConfluenceResult kind` → `createComment` is gated on `getCommentCapability()` reading `write:comment:confluence`; the same `run()` token/refresh/`reconnect_needed` + `write_not_authorized` short-circuit discipline as every other op; returns the shared `ConfluenceResult<T>` union. **Reusable verbatim for the new IPC add-comment path.**
- `confluence IPC handlers ConfluenceApi window.cosmos.confluence getPage searchContent connection status` + Read `src/shared/ipc/confluence.ts` → the renderer surface `ConfluenceApi` is **read-only** today (`getStatus/connect/disconnect/cancelConnect/searchContent/defaultFeed/getPage/onStatusChanged`). **No comment read OR write is exposed to the renderer** — the existing comment write is MCP-tool-only. This feature adds two renderer IPC methods.
- `CONFLUENCE_OAUTH_SCOPES atlassianConfig read:comment confluence` + Read `src/main/integrations/atlassianConfig.ts` → granted set is `read:page`, `read:space`, `read:attachment`, `search`, `write:page`, **`write:comment:confluence`**, `offline_access`. **`write:comment:confluence` is ALREADY granted (adding a comment needs no re-auth). `read:comment:confluence` is NOT in the set → reading comments REQUIRES a new scope → one-time disconnect+reconnect.**
- `Jira comments dock CommentList CommentRow AddCommentControl jira.comment` → the **direct UI precedent**: `jiraCatalog` already renders `CommentList`/`CommentRow` (flat list, author + ts + body) and `AddCommentControl` (Textarea + submit, disabled-until-non-empty, in-flight lock), with a deterministic `jira.comment` action. Confluence mirrors the same shapes against its own dock.
- Read `src/shared/confluence.ts` → `ConfluenceResult<T>` union + `ConfluenceCommentParams`/`ConfluenceCommentResult` (write) already exist; `ConfluenceConnectionState` (`not_connected|connecting|connected|reconnect_needed`) drives the panel's existing Connect/Reconnect affordance (`SettingsDialog` `ConnectionBlock`).

**memory_recall / memory_smart_search (prior decisions):**

- `Confluence write comment scope write:comment:confluence OAuth re-auth MCP` and `Confluence comment add write scope re-auth Atlassian OAuth MCP` → empty store. Persisted this feature's key finding (comment-read scope gap + MCP-vs-renderer-IPC split) with `memory_save` after grounding.

**Key consequence carried into the FRs:** the request is a **dock UI** (renderer) feature, but today comments are only reachable through the agent (write) and not at all (read). So this spec adds a renderer IPC read+write path; the **comment-add scope is already granted**, but **comment-read needs a new `read:comment:confluence` scope → a one-time re-auth**. The not-yet-authorized state is therefore a first-class, graceful UI state — never a crash.

---

## Overview

In the Confluence page dock (the right-side overlay that opens when a page is viewed), show the page's **comments** and let the user **add a comment** — without leaving cosmos and without routing through the AI agent. The comments list and the compose box live inside the existing dock body beneath the page detail; both go through new renderer IPC (`window.cosmos.confluence.*`) that main backs with the existing token-in-main, validate-at-boundary, `ConfluenceResult<T>` discipline.

## User Scenarios

> Each scenario is independently testable. Priorities: P1 (must), P2 (should), P3 (nice to have).

### See a page's comments when the dock opens · P1

**As a** Confluence user viewing a page in the dock
**I want to** see the page's comments below the page content
**So that** I can read the discussion without opening Confluence in a browser

**Acceptance criteria:**

- Given a connected Confluence panel with the comment-read scope granted, when I open a page in the dock, then the dock shows a **comments section** listing that page's top-level footer comments (each with author name and body; and a timestamp when available), most-recent ordering consistent with what Confluence returns.
- Given the comments are still loading, then the comments section shows a **loading** affordance (not an empty "No comments" message and not a crash).
- Given the page has **zero** comments, then the section shows a calm **empty** state ("No comments yet." or similar), not an error.
- Given I retarget the dock to a different page (click another row), then the comments section **reloads for the new page** and never shows the previous page's comments.

### Add a comment to the open page · P1

**As a** Confluence user viewing a page in the dock
**I want to** type a comment and submit it
**So that** I can leave feedback on the page from cosmos

**Acceptance criteria:**

- Given the dock is open on a page and Confluence is connected with the comment-write scope, when I type non-empty text into the compose box and submit, then cosmos posts a footer comment to that page and the **new comment appears in the comments list** (via re-fetch or optimistic insert) without a full panel reload.
- Given my comment is being submitted, then the submit control shows an **in-flight** state and is not double-submittable; on success the compose box clears.
- Given the compose box is **empty or whitespace-only**, then the submit control is **disabled** (no request is sent).
- Given the submit **fails** (network / REST error), then a recoverable inline error is surfaced near the compose box, the typed text is **preserved** so I can retry, and the app does not crash.

### Comment-read not yet authorized → graceful re-auth affordance · P1

**As a** user whose token predates the comment-read scope (or who connected before this feature)
**I want** a clear, recoverable prompt instead of a broken or empty comments section
**So that** I know to reconnect Confluence to view comments — without losing the rest of the panel

**Acceptance criteria:**

- Given the stored token lacks `read:comment:confluence`, when the dock tries to load comments, then the comments section shows a **"reconnect to view comments"** affordance (a connect/reconnect action) instead of a comment list — the page detail above it still renders, and nothing crashes.
- Given I reconnect (re-consent granting the comment-read scope), when the dock reloads comments, then the comments list appears normally.
- Given the comment-read scope is missing, the **add-comment** capability is independent: if `write:comment:confluence` is granted the compose box still works; if it too is missing, adding a comment surfaces the existing scope-gap "reconnect to comment" state (no crash).

### Comment-add not authorized · P2

**As a** user whose token lacks the comment-write scope
**I want** the compose attempt to fail safely with a reconnect prompt
**So that** I am told to reconnect rather than seeing a silent failure or crash

**Acceptance criteria:**

- Given the stored token lacks `write:comment:confluence`, when I submit a comment, then the dock surfaces a recoverable "reconnect Confluence to comment" notice (mapped from the manager's `write_not_authorized`); no write is attempted; the typed text is preserved; no crash.

### Not connected / reconnect needed / REST failure · P1

**As a** user whose connection is missing, expired, or whose Confluence call fails
**I want** comments view + add to degrade to recoverable states
**So that** the dock never hangs, white-screens, or leaks a token

**Acceptance criteria:**

- Given Confluence is `not_connected` or `reconnect_needed`, when the dock would load comments or I submit one, then the existing panel-level Connect/Reconnect affordance applies (via `confluence:statusChanged`); no comment section is left in a stuck spinner; no crash.
- Given a comment read/add REST call fails (403/404/429/network), then the failure is surfaced as a recoverable, non-secret notice via the existing `mapConfluenceError` discipline; no token/secret/stack trace appears anywhere; no crash.
- Given I switch the dock to another page (or close it) **while comments are loading**, then the in-flight result for the old page is discarded (never rendered against the new page); no crash.

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional. Every FR traces to a scenario above or a named precedent. NO scope creep beyond view + add.

| ID     | Requirement |
|--------|-------------|
| FR-001 | The Confluence page dock MUST display a **comments section** for the open page, beneath the existing page detail, inside the existing dock body. It MUST NOT replace or alter the page-detail rendering. (Traces: "See a page's comments".) |
| FR-002 | The comments section MUST show, per comment, the **author display name** and the **comment body** (rendered as readable text), and a **timestamp when Confluence provides one** (degrade-to-omit when absent). v1 lists **top-level footer (page) comments only** as a **flat list** — threaded replies are NOT rendered as a tree (see Edge Cases / Open Questions). (Traces: "See a page's comments"; mirrors Jira `CommentRow`/`CommentList`.) |
| FR-003 | Reading comments MUST be a **renderer IPC read** (new `window.cosmos.confluence.getComments`) backed by a new `ConfluenceManager.getComments` → new `ConfluenceClient.getComments` issuing `GET {base}/wiki/api/v2/pages/{id}/footer-comments` (with body rendered as readable text). It MUST return the shared `ConfluenceResult<T>` discriminated union. It MUST NOT route through the AI agent / MCP tool path. (Traces: "See a page's comments"; the renderer-local dock posture of `confluence-page-detail-dock-v1`.) |
| FR-004 | Reading footer comments REQUIRES the granular OAuth scope **`read:comment:confluence`**, which `CONFLUENCE_OAUTH_SCOPES` does NOT currently request. This feature MUST add it to the Confluence scope set. This is a **consent change**: every already-connected user MUST disconnect + reconnect ONCE to grant it. Until then, the comments read MUST short-circuit to a **comment-read-not-authorized** state (no client call) so the panel surfaces a reconnect affordance — never a crash, hang, or misleading "no comments". (Traces: "Comment-read not yet authorized".) |
| FR-005 | The dock MUST provide a **compose affordance** (a multi-line input + a submit control) to add a comment to the open page. The submit control MUST be **disabled when the input is empty or whitespace-only** (no request sent), and MUST show an **in-flight** state that prevents double-submit. On success the input MUST clear. (Traces: "Add a comment"; mirrors Jira `AddCommentControl`.) |
| FR-006 | Adding a comment MUST be a **renderer IPC write** (new `window.cosmos.confluence.addComment`) that reuses the EXISTING `ConfluenceManager.createComment` (already gated on `getCommentCapability()` / `write:comment:confluence`, already issuing `POST /wiki/api/v2/footer-comments`). No second comment-write implementation. It MUST NOT route through the AI agent / MCP tool path. The existing `confluence_create_comment` MCP tool MUST remain unchanged (the two paths coexist). (Traces: "Add a comment"; reuse of `confluence-mcp-write-v1` §Comment.) |
| FR-007 | Adding a comment requires `write:comment:confluence`, which **is already granted** (no NEW scope for add). When a (pre-comment-scope) token lacks it, the add MUST short-circuit to the existing `write_not_authorized` result and the dock MUST surface a recoverable "reconnect to comment" notice; no write attempted; no crash. The comment-read and comment-write capabilities MUST be **independent** (one missing MUST NOT disable the other). (Traces: "Comment-add not authorized"; `getCommentCapability` precedent.) |
| FR-008 | After a successful add, the new comment MUST appear in the dock's comments list **without a full panel reload** — by **re-fetching the page's comments** (preferred) or by an **optimistic insert reconciled by a re-fetch**. The exact mechanism is pinned in the plan; either way a subsequent read failure MUST NOT crash and MUST leave a recoverable state. (Traces: "the new comment appears in the comments list".) |
| FR-009 | The comments section + compose box MUST be **scoped to the open page** and reload/reset on dock **retarget** (clicking another row) and clear when the dock **closes**. An in-flight read/add result for a page no longer in view MUST be **discarded** (never rendered against a different page). (Traces: "reloads for the new page"; "switch the dock while loading"; the per-page/per-tab reset of `confluence-page-detail-dock-v1` FR-010.) |
| FR-010 | The comment IPC channels, the new op(s), and the param/result shapes MUST be the SINGLE typed contract in `src/shared/ipc/confluence.ts` + `src/shared/confluence.ts` (a new `getComments` channel; a comment-read params + a `ConfluenceComment` DTO; the add-comment IPC reuses `ConfluenceCommentParams`/`ConfluenceCommentResult`), never an ad-hoc channel string. Main MUST **validate every comment IPC payload at the boundary**: an invalid payload is warned + ignored and returns a structured error result — never crashes. (Traces: one-typed-IPC-contract + validate-at-boundary invariant; CLAUDE.md.) |
| FR-011 | Confluence access/refresh tokens and the Atlassian `client_secret` MUST remain **main-process only** (encrypted at rest via `safeStorage`); NEVER in any comment IPC payload, bridge frame, MCP result, A2UI surface, log line, or rendered DOM. Comment **author display name + body + timestamp** are non-secret content and MAY be surfaced; NO new type, param, or result introduced here may carry a secret. (Traces: load-bearing security invariant; CLAUDE.md verbatim.) |
| FR-012 | All comment view/add failures (comment-read-not-authorized, `write_not_authorized`, `not_connected`, `reconnect_needed`, `rate_limited`, 403/404, `network`, empty body) MUST be surfaced as recoverable, structured states and MUST NOT crash, hang, white-screen, or leak a token/secret/stack trace. (Traces: "Not connected / reconnect needed / REST failure".) |
| FR-013 | Every EXISTING Confluence dock + panel surface MUST remain unchanged: the native `PageDetail` body, the "Open in Confluence" header link, the dock open/close/retarget/selected-row behavior, search/default-feed, tabs, refresh, pagination, the NL composer, and the existing `confluence_create_comment` MCP tool. Adding the comments section MUST be additive. (Traces: non-regression; the dock + write specs this extends.) |

## Edge Cases & Constraints

- **Page with zero comments** → calm empty state ("No comments yet."), not an error (FR-001/FR-002).
- **Comments still loading** → loading affordance; no premature empty/error; an in-flight result for a page no longer in view is discarded (FR-009).
- **Empty / whitespace-only compose** → submit disabled, no request (FR-005).
- **Very long comment body** → accepted; the compose box scrolls/caps height (mirrors Jira `AddCommentControl` `max-h`), the rendered comment wraps/breaks long words; no layout break or crash (display concern pinned in the design).
- **Comment-read scope missing** (`read:comment:confluence` not granted — the default for every pre-existing connection) → comments section shows a reconnect affordance; page detail above still renders (FR-004).
- **Comment-write scope missing** (a pre-comment-scope token) → add short-circuits to `write_not_authorized` with a reconnect notice; reads/detail unaffected (FR-007).
- **Not connected / reconnect needed** → panel-level Connect/Reconnect applies via `confluence:statusChanged`; no stuck spinner (FR-012).
- **REST failure (403/404/429/network)** → recoverable, non-secret notice via `mapConfluenceError`; typed comment text preserved on an add failure (FR-008/FR-012).
- **Retarget / close while loading or after a partial add** → reset to the new page / clear; discard stale in-flight results (FR-009).
- **Security** → tokens + `client_secret` stay in main; only non-secret author/body/timestamp cross IPC (FR-011).

**Explicitly out of scope (deferred — NO scope creep):**

- **Inline / anchored comments** (comments attached to a text selection) — v1 is **footer/page comments only**.
- **Threaded reply tree** — v1 shows a **flat list of top-level comments**; rendering/!creating nested replies is deferred (see Open Questions; only revisit if the read returns replies cheaply).
- **Edit / delete a comment**, **reactions / likes**, **@-mentions** (compose-time mention picker), resolving comments, comment permalinks — all out of scope.
- **Rich-text comment composing** — plain text only (converted to storage by the existing `plainTextToStorage`, identical to the existing write).
- Any change to the `confluence_create_comment` **MCP tool** (it stays as-is; this adds a parallel renderer path).

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | Opening a page in the dock (connected, comment-read scope granted) shows that page's top-level footer comments (author + body, timestamp when present), with distinct loading / empty / error states — no crash. |
| SC-002 | Retargeting the dock to another page reloads its comments and never shows the prior page's comments; an in-flight read for a no-longer-open page is discarded. |
| SC-003 | Typing non-empty text and submitting posts a footer comment and the new comment appears in the list without a full panel reload; the compose clears; an empty/whitespace compose keeps submit disabled. |
| SC-004 | A submit failure surfaces a recoverable inline error, preserves the typed text, and never crashes. |
| SC-005 | With `read:comment:confluence` NOT granted, the comments section shows a reconnect affordance (page detail still renders); after reconnecting (granting the scope) the comments load normally. Comment-read and comment-write capability are independent. |
| SC-006 | With `write:comment:confluence` NOT granted, an add short-circuits to a recoverable "reconnect to comment" notice (no write attempted); reads/detail unaffected. |
| SC-007 | not_connected / reconnect_needed / 403 / 404 / 429 / network failures for comment view+add all surface recoverable, non-secret states (no hang, crash, or leaked token/secret/stack trace). |
| SC-008 | No comment IPC payload, type, result, or log line carries the access token, refresh token, or `client_secret`; the ONLY new OAuth scope added is `read:comment:confluence` (comment-add reuses the already-granted `write:comment:confluence`). |
| SC-009 | The new comment-read validator + the manager/client comment-read logic are unit-testable without Electron/network and never throw on malformed input; the add path reuses the existing `createComment` discipline. |

---

## Open Questions

- [ ] **OQ-1 — Threaded replies: flat list vs. tree (v1 default = FLAT).** Confluence footer comments can have replies (`/wiki/api/v2/pages/{id}/footer-comments` returns top-level comments; replies are a separate `/footer-comments/{id}/children` read). **Recommendation: v1 renders a FLAT list of top-level comments only** (matches Jira's flat `CommentList`, avoids an N+1 reply fetch). Surface replies as a follow-up ONLY if the top-level read cheaply includes a reply count/preview. Confirm acceptable, or request the reply tree for v1.
- [ ] **OQ-2 — Re-fetch vs. optimistic insert after add (FR-008).** **Recommendation: re-fetch the page's comments after a successful add** (simplest, always-consistent, reuses the read path) — accepting a brief post-submit reload. An optimistic insert is snappier but needs reconciliation against the server's canonical comment (id, rendered body, ts). Pinned in the plan; flag if a user preference exists for instant-insert.
- [ ] **OQ-3 — Comment body rendering fidelity.** Footer comments are storage/`view` HTML like page bodies. **Recommendation: render the comment body as the SAME sanitized readable text the page detail uses** (DOMPurify at the display site) for consistency, OR flatten to plain text if rich comment HTML is rare/noisy. The designer + plan pin whether comments reuse the page-body sanitizer or a lighter plain-text flatten. Not blocking the contract.
- [ ] **OQ-4 — Re-auth UX placement.** The comment-read-not-authorized state needs a connect/reconnect affordance. **Recommendation: an inline affordance in the comments section that triggers the existing `window.cosmos.confluence.connect()` flow** (reuse, no parallel connect path), consistent with `SettingsDialog` `ConnectionBlock`. Confirm whether the inline prompt should deep-link to Settings or trigger connect directly in place. (Owned by the designer in the Design step.)
