/**
 * confluenceCatalog/logic — pure, side-effect-free helpers for the Confluence custom
 * A2UI catalog (Slack + Confluence generative-UI v1). Extracted from `components.tsx` so
 * the display decisions are unit-testable without a DOM. Mirrors `slackCatalog/logic.ts`.
 */

/** A list count label ("1 result" / "N results") with correct pluralization. */
export function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
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
