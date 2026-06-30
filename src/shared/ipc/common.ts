/**
 * Shared IPC contract primitives (cosmos).
 *
 * Cross-domain values that more than one IPC domain module depends on, kept here
 * so domain modules depend DOWNWARD on `common` (never on each other's modules
 * for these) — this breaks the only cross-domain contract dependency and keeps the
 * `src/shared/ipc/` directory acyclic. Re-exported (unchanged) through the
 * `src/shared/ipc.ts` barrel.
 */

/**
 * Jira generative-UI v2 — render-target discriminator (D1 / v2 FR-004, FR-012).
 *
 * The EXISTING `ui:render` channel now carries a `target` so MULTIPLE panels can
 * consume it, each hosting its OWN `A2UIProvider`/catalog and FILTERING incoming
 * `ui:render` by `target` (rendering only payloads whose `target` matches its own
 * panel, ignoring the rest). No dedicated Jira channel set is added.
 *
 *  - `'generated-ui'` — the Home agent's WIRE TARGET: `target: 'generated-ui'`
 *    frames render into the Home / Cosmos surface with the A2UI standard catalog
 *    (not a separate standalone panel). The DEFAULT a render frame gets when
 *    `render_ui` omits `target` (backward-compatible with the unchanged standard
 *    `render_ui`).
 *  - `'jira'` — the native Jira rail panel (the `catalogId: 'jira'` custom catalog).
 *    Set by the deterministic default-view + post-write re-pushes and by the
 *    Jira-scoped `render_jira_ui` tool.
 *  - `'slack'` — the native Slack rail panel (the `catalogId: 'slack'` custom
 *    catalog). Set by the Slack-scoped `render_slack_ui` tool. Display-only / read-only
 *    (Slack + Confluence generative-UI v1, FR-001).
 *  - `'confluence'` — the native Confluence rail panel (the `catalogId: 'confluence'`
 *    custom catalog). Set by the Confluence-scoped `render_confluence_ui` tool.
 *    Display-only / read-only (Slack + Confluence generative-UI v1, FR-001).
 *  - `'google-calendar'` — the native Google Calendar rail panel (the
 *    `catalogId: 'google-calendar'` custom catalog). Set by the deterministic
 *    default-view re-pushes and by the Google-scoped `render_google_calendar_ui`
 *    tool. Display-only / read-only (Google Calendar integration v1).
 */
export type UiRenderTarget =
  | 'jira'
  | 'generated-ui'
  | 'slack'
  | 'confluence'
  | 'google-calendar'

/** The default render target when a render frame omits one (D1 / v2 FR-004). */
export const DEFAULT_UI_RENDER_TARGET: UiRenderTarget = 'generated-ui'
