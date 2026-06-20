# Bug Report: slack-attachment-image-broken (v1)

- **Status:** Fixed (pending user reconnect + GUI verify)
- **Reported:** 2026-06-20
- **Severity:** broken (visible fidelity loss — attachment images unusable)
- **Follows:** `slack-rich-message-render-v1` (the feature that introduced attachment-image render)

## Symptom (Step 1)

User, immediately after the `slack-rich-message-render-v1` relaunch + Slack reconnect:
- Custom emoji `:thumbsup_all:` — **now renders correctly** after the reconnect granted `emoji:read`.
  (Not a defect; was just the expected one-time reconnect.)
- Attachment **images still render as a broken-image** form (the `<img>` loads but fails).

So the post-reconnect state isolates the defect to **attachment images only** (the `files.slack.com`
proxy path), NOT custom emoji (the public `emoji.slack-edge.com` CDN path) and NOT the protocol
decode/render pipeline (which custom emoji exercise successfully).

## Expected vs Actual

- **Expected:** an uploaded image attachment renders inline as a thumbnail.
- **Actual:** the `<img src="cosmos-slack-img://…">` resolves to a broken image.

## Reproduction

1. Connect Slack (with the new `emoji:read` scope granted via reconnect).
2. Open a channel whose history has a message with an uploaded image attachment.
3. Observe: custom emoji glyphs render; the image attachment shows the browser broken-image state.

## Root-cause direction (pre-routing triage)

The custom-emoji image (`emoji.slack-edge.com`, a PUBLIC CDN — no auth needed) renders, while the
attachment image (`files.slack.com`, AUTH-gated) breaks, even though the protocol handler attaches
`Authorization: Bearer <user token>` to both (`src/main/slackImageProtocol.ts:83`). The differing
variable is **token scope**: downloading `files.slack.com` `url_private` / `thumb_*` content requires
the Slack user token to carry the **`files:read`** scope. The current `SLACK_USER_OAUTH_SCOPES`
(`src/main/integrations/slackConfig.ts:26`) lists `channels:read, channels:history, users:read,
search:read, emoji:read` — **`files:read` is absent**. Without it, an authenticated `files.slack.com`
fetch returns a non-image response (login/redirect/403), so the `<img>` shows broken.

This is consistent with: emoji (public) works, attachments (auth) fail, bearer attached in both cases,
decode/render verified by the working emoji path, CSP correct (`cosmos-slack-img:` present).

Hypothesis to VERIFY (developer): adding `files:read` to the requested `user_scope` (and a one-time
reconnect to grant it) lets `files.slack.com` downloads succeed. `files:read` is read-only — consistent
with the integration's read-only posture (SC-011). If verification shows the fetch ALSO needs redirect
or content-type handling beyond scope, widen the fix accordingly.

## Scope gate (Step 1.5)

- **Decision:** stays in **bug cycle** — contained one-layer fix (main OAuth config). Route to `developer`.
- Not a new contract / not net-new behavior / not cross-layer: a missing read scope on an existing flow.

## Root cause (Step 3)

`SLACK_USER_OAUTH_SCOPES` (`src/main/integrations/slackConfig.ts:26`) omitted `files:read`. Slack
gates `files.slack.com` `url_private` / `thumb_*` downloads behind that scope; without it the
authenticated `net.fetch` in the proxy handler (`slackImageProtocol.ts:83`) gets a non-image
(login/403) response, so the `<img>` renders broken. The public emoji CDN
(`emoji.slack-edge.com`) needs no auth, which is why custom emoji rendered fine and isolated the
defect to the auth-gated attachment path.

## Fix (Step 4)

Added `'files:read'` to `SLACK_USER_OAUTH_SCOPES` (read-only, preserves SC-011). The proxy code,
codec, CSP, and DTO were already correct — only the requested scope was missing.

## Regression test (Step 5)

`src/main/integrations/slackConfig.test.ts` — asserts the scope list contains `files:read` (the
bug; fails on the pre-fix list) and `emoji:read`, the core read scopes, and that NO `:write` scope
is ever requested. Would have failed before Step 4 (`files:read` absent).

## Verify (Step 6)

`npm run typecheck` — exit 0. `npm test` — **1447 passed** (79 files; +4 new). The actual
`files.slack.com` fetch could NOT be exercised headlessly (no Slack runtime). **User must reconnect
Slack** (an OAuth scope change only takes effect on a fresh authorize granting `files:read`), then
confirm attachment images render.

