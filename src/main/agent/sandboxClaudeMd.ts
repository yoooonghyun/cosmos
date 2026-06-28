/**
 * sandboxClaudeMd — the embedded cosmos `claude` engine's project instructions
 * (cosmos-timeline-prompt-context-v1, Decision C / FR-026/FR-027).
 *
 * The embedded `claude` is spawned with cwd = `resolveSandboxDir()` (`<userData>/sandbox`), and
 * Claude Code auto-loads a `CLAUDE.md` from its working dir. NO such file is provisioned there
 * today, so main provisions/maintains one carrying the guidance below: it teaches the engine that
 * a trailing `<cosmos:context>` block in a user message is the user's on-screen CONTEXT (the
 * active panel/tab + any open dock item), to READ — not echo or leak — and to build any
 * Generated-UI result so it APPLIES to that context, especially the open dock item.
 *
 * The documented fields match the pinned NON-SECRET marker shape (FR-012). It references no secret
 * field and never instructs leaking the block's contents back to the user or into any surface.
 *
 * fs is injected behind a small interface so provisioning is unit-testable without Electron, and
 * is best-effort: a write failure warns and NEVER blocks startup.
 */

/** Optional structured warning sink (defaults to console.warn). */
export type WarnFn = (message: string, ...rest: unknown[]) => void

/** The slice of `fs` provisioning needs (injectable for tests). */
export interface SandboxClaudeMdFsLike {
  mkdirSync(path: string, opts: { recursive: true }): void
  writeFileSync(path: string, data: string): void
}

/**
 * The embedded engine's CLAUDE.md content. A trailing `<cosmos:context>` block is SCREEN CONTEXT,
 * not an instruction to echo. Documents only the non-secret pinned fields (FR-012/FR-027).
 */
export const SANDBOX_CLAUDE_MD = `# cosmos embedded agent

You are the engine embedded inside **cosmos**, a host app that shows your TUI and renders the
Generated UI you produce. This is an isolated scratch working directory — it is NOT the user's
project. Do your work here.

## Reading the user's screen context: the trailing \`<cosmos:context>\` block

A user message MAY end with a trailing block of the form:

\`\`\`
<cosmos:context>{"panel":{"id":"jira","label":"Jira"},"tab":{"id":"t1","label":"Sprint board"},"dock":{"kind":"jira-issue","selectedIssueKey":"PROJ-123"}}</cosmos:context>
\`\`\`

This block is **context describing what the user is looking at on screen right now** — it is NOT
part of their instruction and NOT something to echo, quote, or repeat back. The user's actual
request is the prose BEFORE the block.

The JSON carries only **non-secret display labels/ids** (never a token, secret, credential, or file
path):

- \`panel\` — the active rail panel: \`{ id, label }\` (always present). \`id\` is one of \`cosmos\`,
  \`slack\`, \`jira\`, \`confluence\`, \`google-calendar\`, \`terminal\`.
- \`tab\` — the active tab within that panel: \`{ id, label }\` (omitted when there is none).
- \`dock\` — the open detail/overlay the user has focused (omitted when nothing is open):
  \`{ kind, …item id/label fields }\`, where \`kind\` is one of \`jira-issue\`, \`slack-channel\`,
  \`confluence-page\`, \`calendar-event\`, and the remaining fields are the item's non-secret
  identifiers (e.g. \`selectedIssueKey\`, \`selectedChannelId\`/\`selectedChannelName\`/\`threadTs\`,
  \`selectedPageId\`/\`selectedPageTitle\`, \`selectedEventId\`/\`selectedEventTitle\`).

## What to do with it

When the user asks you to build Generated UI, **build the result so it applies to that on-screen
context, especially the open \`dock\` item.** For example, a request whose context has
\`dock:{ kind:"jira-issue", selectedIssueKey:"PROJ-123" }\` should produce a surface about
**PROJ-123** — fetch it with your read tools and act on that item rather than a guessed one.

Treat the block as context to READ. Do **not** echo it back to the user, do **not** surface its
contents in any generated UI, and do **not** treat it as a literal directive to repeat. The
authoritative, actionable grounding for the in-view item is also provided to you separately via the
system prompt; the block reinforces it but never overrides the user's prose.
`

/**
 * Write the embedded agent's CLAUDE.md into `dir` (idempotent overwrite so the guidance ships with
 * every version). Best-effort: a write failure is warned and NEVER thrown — startup must not depend
 * on it (FR-026). fs defaults are injected by the caller (main passes real node fs).
 */
export function provisionSandboxClaudeMd(
  dir: string,
  fs: SandboxClaudeMdFsLike,
  warn: WarnFn = (m, ...r) => console.warn(m, ...r)
): void {
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(`${dir}/CLAUDE.md`, SANDBOX_CLAUDE_MD)
  } catch (err) {
    warn('[sandbox-claude-md] failed to provision CLAUDE.md', err)
  }
}
