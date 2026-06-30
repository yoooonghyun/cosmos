/**
 * tabIcons — the PURE, framework-free vocabulary + helpers for the per-tab random
 * "cosmos" glyph (cosmos-random-tab-icons-v1).
 *
 * This module is the SINGLE source of the 14-icon SET ({@link TAB_ICON_IDS}) as plain
 * string `iconId`s. It imports NO React / lucide so it is node-testable AND importable by
 * the MAIN process snapshot validator (the `.ts`/`.test.ts` split). The renderer maps each
 * id to a lucide component in `src/renderer/tabs/tabIconRegistry.tsx`.
 *
 * SECURITY: an `iconId` is a bounded enum string (one of the 14 kebab names below) — it is
 * NON-SECRET and carries no token/path/credential. It rides the existing per-tab snapshot
 * shapes exactly like `renamed`/`hiddenCalendars` (additive-optional, no schema bump).
 *
 * RANDOMNESS DISCIPLINE (FR-002/FR-003): {@link randomTabIconId} uses `Math.random` and is
 * called ONLY from event-time mint sites (a `+`/new-tab handler, terminal `mintTab`, an
 * unsolicited-frame auto-create) — NEVER during render or a pure lazy-initializer. The
 * hydrate/initializer fallback uses {@link tabIconIdFromKey} (a DETERMINISTIC id-hash, no
 * `Math.random`) so a restored/seeded tab gets a stable glyph with no render-phase side effect.
 */

/** The 14 curated lucide icon ids (kebab of the icon name), in a fixed order. FR-001. */
export const TAB_ICON_IDS = [
  'rocket',
  'orbit',
  'satellite',
  'satellite-dish',
  'telescope',
  'atom',
  'star',
  'moon-star',
  'moon',
  'sun',
  'sun-moon',
  'sparkle',
  'sparkles',
  'earth'
] as const

/** A valid per-tab icon id — one of the 14 {@link TAB_ICON_IDS}. */
export type TabIconId = (typeof TAB_ICON_IDS)[number]

/** True when `v` is one of the 14 known icon ids (membership test; FR-007). */
export function isTabIconId(v: unknown): v is TabIconId {
  return typeof v === 'string' && (TAB_ICON_IDS as readonly string[]).includes(v)
}

/**
 * A uniform random pick from the 14-icon set (FR-002). Uses `Math.random`, so it MUST be
 * called only from an event-handler mint site — never render / a pure initializer / hydrate
 * (the render path must never call `Math.random`, FR-003).
 */
export function randomTabIconId(): TabIconId {
  const idx = Math.floor(Math.random() * TAB_ICON_IDS.length)
  // Guard the (vanishingly unlikely) Math.random() === 1 boundary.
  return TAB_ICON_IDS[idx === TAB_ICON_IDS.length ? idx - 1 : idx]
}

/**
 * A DETERMINISTIC id for a stable `key` (FR-006): a small string-hash fold of `key` mod 14.
 * Pure, side-effect-free, NO `Math.random` — so the pre-feature/hydrate/initializer fallback
 * assigns the SAME glyph every time for the same tab id, stable within and across sessions.
 */
export function tabIconIdFromKey(key: string): TabIconId {
  const s = typeof key === 'string' ? key : String(key)
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    // A simple, stable 32-bit char-code fold (djb2-ish); `|0` keeps it a 32-bit int.
    hash = (hash * 31 + s.charCodeAt(i)) | 0
  }
  const idx = Math.abs(hash) % TAB_ICON_IDS.length
  return TAB_ICON_IDS[idx]
}
