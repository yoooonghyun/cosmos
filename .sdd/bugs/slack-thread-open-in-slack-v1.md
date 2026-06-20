# Bug Report: slack-thread-open-in-slack (v1)

- **Status:** Implemented (pending user GUI verify in `npm run dev`)
- **Reported:** 2026-06-21
- **Severity:** enhancement (additive affordance — parity with Jira #103 / Confluence #87/#100)
- **Regression:** no — net-new "Open in Slack" link on the thread dock header.

## Request

Add an "Open in Slack" navigation affordance to the Slack THREAD DOCK header so the user can
jump from the in-app thread dock to that thread/message in the real Slack (web/app). Mirrors the
Jira ticket-key link (#103, `jiraWebUrl` → `/browse/<KEY>`) and the Confluence `PageDetailTitle`
external link (#87/#100): an inline anchor + `ExternalLink` glyph, `--ring` focus treatment.

## Decisions (the record asked for these explicitly)

- **Which element is the link:** the thread dock HEADER title affordance — the "Thread" label in
  `SlackThreadPanel`'s top header bar becomes an `<a target="_blank">` with a trailing `ExternalLink`
  icon when a permalink is present. The header `MessageSquare` glyph and the Close (`X`) button are
  unchanged. (Not a per-row link, not a button — a header affordance, matching Confluence's title.)
- **Permalink source — `chat.getPermalink`, NOT hand-built:** the URL is obtained from Slack's own
  `chat.getPermalink` API (args: `channel` = thread `channelId`, `message_ts` = `threadTs`), which
  returns the canonical `permalink`. It is NEVER assembled from
  `https://<team>.slack.com/archives/...` by hand (the Confluence link 404'd twice from guessing the
  shape). Read-only call; needs no extra scope beyond the connection's existing read grant — verified
  against the granted user-token read scopes (`channels:read`/`channels:history`/`users:read`/…),
  `chat.getPermalink` carries no `*:read`-style scope requirement. No new scope requested.
- **When the permalink is fetched:** on THREAD OPEN / detail build. The dock already calls
  `getReplies` when a thread opens; `SlackClient.getReplies` now additionally calls
  `chat.getPermalink` for the thread root and attaches the resolved `permalink` to the FIRST page
  only (no cursor). Paginated reply pages do NOT re-resolve it (the header is fixed). The renderer
  lifts the permalink off the first load result into panel state so it survives reply-list remounts.
- **Absent-permalink fallback:** degrade-to-omit. A failed/empty/non-openable permalink is omitted
  from the page (`undefined`) and NEVER fails the replies read. With no permalink the header renders
  the plain "Thread" label — no icon, no anchor, no extra tab stop. The renderer additionally
  re-validates the carried value through an openable-`http(s)` guard, so a non-`http(s)`/malformed
  string can never become a live link.

## Design / approach

- **New DTO field (non-secret):** `SlackPage<T>.permalink?: string` (`src/shared/slack.ts`),
  carried ONLY by the `getReplies` (thread) read. The canonical web URL only — never a token or a
  token-bearing URL (SC-008). One typed IPC contract; the `slack:getReplies` handler returns the
  typed `SlackResult` unchanged (the renderer consumes it).
- **Openable-URL guard (warn-and-drop at the boundary):** the permalink is validated to an absolute
  `http(s)` URL at the point main reads the `chat.getPermalink` response (`permalinkFromResponse`),
  so a malformed / non-`http(s)` value is dropped and the field omitted — no crash. Mirrors the
  Confluence `isOpenableWebUrl` guard.
- **Security:** the Slack user token stays in MAIN only (attached inside `SlackClient`/`SlackManager`);
  only the resolved permalink string crosses IPC. No token in any payload/bridge frame/surface.

## Files changed

- `src/main/integrations/slackPermalink.ts` (NEW) — pure helpers: `isOpenableWebUrl` (the
  `http(s)` openable guard) + `permalinkFromResponse` (read the permalink off a raw
  `chat.getPermalink` body, only when openable). No fetch, no token, node-testable.
- `src/main/integrations/slackClient.ts` — `getReplies` now resolves the thread root permalink via
  a new private `getPermalink` (`chat.getPermalink`) and attaches `permalink` to the first page;
  failure/non-openable → omitted, never fails the replies read.
- `src/shared/slack.ts` — added the non-secret `SlackPage<T>.permalink?` field.
- `src/renderer/slackThreadPanelLogic.ts` — added `isOpenableThreadPermalink` (the renderer-side
  re-validation guard; node-testable).
- `src/renderer/SlackPanel.tsx` — `SlackThreadPanel` captures the permalink from the `getReplies`
  load into state (reset on thread change), and renders the header title as an "Open in Slack"
  external link when openable (else the plain "Thread" label). Imports `ExternalLink`.

## Tests (Step 5)

- `src/main/integrations/slackPermalink.test.ts` (NEW) — `isOpenableWebUrl` + `permalinkFromResponse`:
  spec-compliant openable URL passes; missing optional omits; invalid/non-`http(s)`/non-object
  dropped (safe fallback, no crash).
- `src/main/integrations/slackClient.test.ts` — `getReplies` carries the permalink from
  `chat.getPermalink` (happy path); omits it when `chat.getPermalink` fails (replies read still
  succeeds); does NOT re-resolve on a cursor page; drops a non-`http(s)` permalink (guard).
- `src/renderer/slackThreadPanelLogic.test.ts` — `isOpenableThreadPermalink`: openable passes,
  missing omits, non-`http(s)`/malformed → no live link.

## Verification (Step 6)

- [x] `npm run typecheck` green
- [x] `npm test` green (affected suites 59/59; full run below)
- [ ] Original behavior — clicking the thread-dock header "Open in Slack" opens the canonical Slack
  thread/message in the browser/app; header is a plain label when no permalink resolves
  (USER GUI verify, `npm run dev` — not exercisable headless; the permalink comes from the real
  `chat.getPermalink` API so it should resolve).
