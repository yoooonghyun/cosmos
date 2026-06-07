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
