/**
 * confluenceCatalog/logic — pure, side-effect-free helpers for the Confluence custom
 * A2UI catalog (Slack + Confluence generative-UI v1). Extracted from `components.tsx` so
 * the display decisions are unit-testable without a DOM. Mirrors `slackCatalog/logic.ts`.
 */

/** A list count label ("1 result" / "N results") with correct pluralization. */
export function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/* ------------------------------------------------------------------------- *
 * Click-to-open page detail (confluence-page-detail-nav-v1, FR-001/FR-002/FR-003)
 * ------------------------------------------------------------------------- */

/**
 * The renderer-local nav action a clicked `SearchResultRow` emits to open its page's
 * detail in place (FR-003). Deliberately NOT a `confluence.*`-prefixed name — it is a
 * navigation signal the `ConfluencePanel` `onAction` seam intercepts and handles
 * renderer-locally (returns `true`), NEVER forwarded to main or the agent. Mirrors the
 * Jira `jiraNav.openDetail` / Slack open-channel seam. The `logic.test.ts` guards that it
 * stays non-`confluence.*`.
 */
export const CONFLUENCE_OPEN_DETAIL_ACTION = 'confluenceNav.openDetail'

/**
 * Whether a `SearchResultRow`'s `id` is a real page id worth emitting an open-detail
 * action for (FR-001/FR-002). True only for a non-empty, non-whitespace string id; a row
 * with no/empty id is INERT (no button, no action). Total — never throws.
 */
export function isOpenDetailEmittable(id: string | undefined): boolean {
  return typeof id === 'string' && id.trim() !== ''
}

/**
 * Whether a page body has readable content. A blank/whitespace-only body shows the
 * "no readable body" empty line (design §3.3) — total, never throws.
 */
export function hasReadableBody(body: string | undefined): boolean {
  return typeof body === 'string' && body.trim() !== ''
}

/* ------------------------------------------------------------------------- *
 * Bound-list display gating (confluence-generative-adapter-v1, FR-004)
 *
 * The bound Confluence lists (the SearchResultList that backs both the default feed
 * and search results) read their rows + `loading`/`hasMore`/`error` flags from the
 * data model and disambiguate the five states (design §3.1). These pure helpers
 * encode that gating so the `.tsx` shell stays thin and the decisions are
 * node-testable (the catalog `.ts`/`.test.ts` split). Copied verbatim from the Slack
 * catalog's `logic.ts` — integration-agnostic pure functions; Confluence is
 * APPEND-ONLY (no prev) + read-only.
 * ------------------------------------------------------------------------- */

/** Coerce a possibly-undefined bound rows value to a safe array (never throws). */
export function boundRows<T>(rows: T[] | undefined): T[] {
  return Array.isArray(rows) ? rows : []
}

/**
 * Whether to render the recoverable-error Notice ABOVE the rows/detail (FR-007 /
 * design §3). True iff a non-empty error message is present. The prior rows/content
 * stay visible (the caller keeps them); an empty list WITH an error shows the Notice
 * instead of the empty state.
 */
export function showErrorNotice(error: string | undefined): boolean {
  return typeof error === 'string' && error.trim() !== ''
}

/**
 * Whether to render the bound empty state (design §3.1). True iff the list is empty
 * AND there is no error notice to show in its place (the error supersedes the empty
 * state).
 */
export function showEmptyState(rowCount: number, error: string | undefined): boolean {
  return rowCount === 0 && !showErrorNotice(error)
}

/* ------------------------------------------------------------------------- *
 * Generative layout width-clamp (bug slack-generative-wrap-v1, Confluence latent instance)
 *
 * The agent groups Confluence lists/detail with the SDK standard-catalog `Column`/`Row`
 * (registered in `index.ts`). Those SDK containers render a `<div>` whose className is a
 * fixed `flex flex-col gap-4` / `flex flex-row gap-3` with NO `min-w-0` — so the flex box
 * keeps its default `min-width: auto` and grows to its content's INTRINSIC width. A long
 * unbroken line therefore expands that container past the panel and overflows horizontally;
 * the leaf's `break-words` and the list root's `min-w-0` never take effect because their
 * containing block is already wider than the panel.
 *
 * We cannot edit the third-party SDK div's className, so the Confluence catalog registers
 * clamped wrappers (see `layout.tsx`) that render the SDK `Column`/`Row` inside a block box
 * carrying this class. `min-w-0` defeats the flex `min-width: auto` floor the wrapper
 * inherits from the panel's flex host; `max-w-full` caps it at the panel width; `w-full`
 * keeps short content filling the column. The class lives here (not the `.tsx`) so the fix
 * is assertable in a node (no-jsdom) unit test — mirroring `slackCatalog/logic.ts`.
 * ------------------------------------------------------------------------- */

/** Width-clamp applied around an agent-emitted SDK Column/Row so its subtree wraps. */
export const CONFLUENCE_LAYOUT_CLAMP_CLASS = 'w-full min-w-0 max-w-full'
