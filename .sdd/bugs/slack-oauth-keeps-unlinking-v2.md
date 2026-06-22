# Bug Report: slack-oauth-keeps-unlinking-v2

**Status:** FIXED
**Files changed:** `src/main/slackManager.ts`, `src/main/slackManager.test.ts`

## Symptom

Slack auth disconnects frequently (reconnect_needed) while Google and Atlassian stay
connected. Reproduces mid-session on rotation-enabled apps after the ~12 h access
token expires, especially when two surfaces (native panel + MCP bridge) are active.

## Root Cause

**Refresh-token race / single-use double-spend** — confirmed by Slack docs.

Slack rotating refresh tokens are **single-use**: each `oauth.v2.access` call with
`grant_type=refresh_token` invalidates the supplied refresh token and issues a new one
(with a short grace period). `SlackManager.tryRefresh` had no single-flight guard.

When the 12 h access token expires, concurrent reads (IPC panel + MCP bridge tool)
each call `ensureToken` → each call `tryRefresh` with the SAME stored refresh token.
The first POST rotates it successfully and saves a new token set. The second POST
sends the now-invalid token → Slack returns `{ ok: false, error: "invalid_refresh_token" }`
→ `postForm` throws → `tryRefresh` catches → `setState('reconnect_needed')`.

**Evidence:**
- `src/main/slackManager.ts:229` — `tryRefresh` had no in-flight deduplication.
- `src/main/slackManager.ts:310` — `run()` enters `tryRefresh` for both proactive
  (ensureToken, line 210) and reactive (reconnect_needed retry, line 321) paths with
  no coordination between concurrent callers.
- Slack docs (https://docs.slack.dev/authentication/using-token-rotation): "Refresh
  tokens are designed to be used once. After calling `oauth.v2.access`, the refresh
  token you used is revoked after a short grace period."
- Only Slack rotates tokens AND has two concurrent consumer surfaces in this codebase,
  which is why Google/Atlassian are unaffected.

## Hypotheses Ruled Out

1. **Refresh response shape wrong** — ruled out. Slack's refresh response for PKCE
   user tokens puts `access_token`/`refresh_token`/`expires_in` at TOP LEVEL, so
   `toExchangeResult` reading `raw.access_token` is correct. Verified via Slack docs.
2. **client_secret missing** — ruled out. PKCE public clients do NOT send
   `client_secret` for refresh (only `client_id`, `grant_type`, `refresh_token`).
   Verified via https://docs.slack.dev/authentication/using-pkce.
3. **safeStorage decrypt failure** — ruled out. Would disconnect on every launch,
   not mid-session on expiry.
4. **clientId drift** — ruled out. `effectiveClientConfig()` is the same call site
   for both connect and refresh at `index.ts:565`.

## Fix

Added `private refreshInFlight: Promise<StoredTokenSet | null> | null = null` to
`SlackManager` (`src/main/slackManager.ts:86-95`). Updated `tryRefresh` to store its
promise in `refreshInFlight` on the first call and return the same promise to any
concurrent caller. The `finally` block clears `refreshInFlight` when settled so the
next expiry cycle issues a fresh POST.

Lines changed: 18 (slackManager.ts), 0 in any other production file.

## Regression Test

`src/main/slackManager.test.ts` — new test:
"single-flight: two concurrent expired-token reads issue exactly ONE refresh POST and
both succeed (slack-oauth-keeps-unlinking-v2)"

The test fires `Promise.all([manager.listChannels({}), manager.listChannels({})])` on
an expired rotating token, then asserts:
- `refresh` mock called exactly **once** (single POST)
- both reads return `ok: true`
- persisted token is the new rotated set
- state stays `connected`

This test FAILS on the pre-fix code (refresh is called twice, second call throws, one
read returns reconnect_needed).

## Verification

- `npm run typecheck` — exit 0 (both tsconfig.node.json + tsconfig.web.json)
- `npx vitest run src/main/slackManager.test.ts` — PASS (29), FAIL (0)
