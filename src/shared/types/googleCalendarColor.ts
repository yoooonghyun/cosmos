/**
 * googleCalendarColor — the pure, deterministic calendar → cosmos color-TOKEN mapping
 * (shared-calendars-v1, FR-006/FR-007). Shared by the main-process surface builder (which
 * resolves the token name ONCE per calendar and ships it on each legend entry) and the
 * renderer catalog logic (which colors event chips + legend swatches by that token), so
 * the swatch and the chips can never drift apart and no raw hex ever reaches a component.
 *
 * NO React, NO DOM, NO secrets. Inputs are a calendar's non-secret id + optional Google
 * `backgroundColor` hex; the output is a bounded {@link GoogleCalendarColorToken} NAME.
 *
 * The mapping is deterministic (FR-007): the SAME calendar always resolves to the SAME
 * token within a view.
 *   1. A recognized GCal palette hex → the nearest cosmos token (a small fixed lookup).
 *   2. Otherwise, a stable hash of the calendar id modulo the non-gray palette size picks
 *      a token (so calendars without a known hex still spread across the wide palette).
 *   3. An absent/garbage input → the `gray` fallback (never throws, never a wrong hue).
 */

import type { GoogleCalendar, GoogleCalendarColorToken } from './googleCalendar'

/**
 * The non-gray palette the id-hash spreads calendars across (shared-calendars-v1 design
 * §2.2). Eleven mutually-distinguishable hues; `gray` is the separate unknown/absent
 * fallback (NOT in this list so a real calendar never hashes onto the fallback hue).
 */
export const CALENDAR_COLOR_TOKENS: readonly GoogleCalendarColorToken[] = [
  'blue',
  'green',
  'purple',
  'red',
  'amber',
  'teal',
  'cyan',
  'indigo',
  'magenta',
  'pink',
  'olive'
]

/** The safe fallback token for an absent/garbage color (design §2.2). */
export const CALENDAR_COLOR_FALLBACK: GoogleCalendarColorToken = 'gray'

/**
 * The well-known GCal calendar `backgroundColor` hexes → the nearest cosmos token. Google
 * draws calendar colors from a fixed palette; mapping the recognized ones gives a stable,
 * sensible hue (e.g. a blue calendar reads blue). An unrecognized hex falls through to the
 * id-hash. Keys are lowercased hex (the lookup lowercases its input). Reinforcement only —
 * a collision onto the same token is acceptable (the legend name disambiguates).
 */
const PALETTE_HEX_TO_TOKEN: Record<string, GoogleCalendarColorToken> = {
  '#ac725e': 'olive', // Cocoa
  '#d06b64': 'red', // Flamingo
  '#f83a22': 'red', // Tomato
  '#fa573c': 'red', // Tangerine (warm)
  '#ff7537': 'amber', // Pumpkin
  '#ffad46': 'amber', // Mango
  '#42d692': 'green', // Eucalyptus
  '#16a765': 'green', // Basil
  '#7bd148': 'green', // Avocado
  '#b3dc6c': 'olive', // Pistachio
  '#fbe983': 'amber', // Citron
  '#fad165': 'amber', // Banana
  '#92e1c0': 'teal', // Sage
  '#9fe1e7': 'cyan', // Peacock
  '#9fc6e7': 'cyan', // Cobalt (light)
  '#4986e7': 'blue', // Blueberry
  '#9a9cff': 'indigo', // Lavender
  '#b99aff': 'purple', // Wisteria
  '#c2c2c2': 'gray', // Graphite
  '#cabdbf': 'gray', // Birch
  '#cca6ac': 'pink', // Beetroot (muted)
  '#f691b2': 'pink', // Cherry Blossom
  '#cd74e6': 'magenta', // Grape
  '#a47ae2': 'purple' // Amethyst
}

/**
 * A tiny deterministic string hash (FNV-1a-ish). Stable across runs/processes so the same
 * calendar id always yields the same bucket. Returns a non-negative 32-bit integer.
 */
export function stableStringHash(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  // Coerce to a non-negative 32-bit integer.
  return h >>> 0
}

/** Normalize a raw hex (`#7986CB`, `7986cb`) to a lowercase `#rrggbb`, or '' when unusable. */
function normalizeHex(raw: string): string {
  const trimmed = raw.trim().toLowerCase()
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
  return /^#[0-9a-f]{6}$/.test(withHash) ? withHash : ''
}

/**
 * Resolve one calendar to its bounded cosmos color token (shared-calendars-v1,
 * FR-006/FR-007). Deterministic: palette-hex lookup → stable id-hash → `gray` fallback.
 * The SAME calendar always yields the SAME token. Pure; never throws.
 */
export function calendarColorToken(calendar: GoogleCalendar | undefined): GoogleCalendarColorToken {
  if (!calendar || typeof calendar.id !== 'string' || calendar.id.length === 0) {
    return CALENDAR_COLOR_FALLBACK
  }
  if (typeof calendar.backgroundColor === 'string' && calendar.backgroundColor.length > 0) {
    const hex = normalizeHex(calendar.backgroundColor)
    const mapped = hex ? PALETTE_HEX_TO_TOKEN[hex] : undefined
    if (mapped) {
      return mapped
    }
  }
  // No recognized hex: stable-hash the id across the non-gray palette (deterministic).
  const idx = stableStringHash(calendar.id) % CALENDAR_COLOR_TOKENS.length
  return CALENDAR_COLOR_TOKENS[idx]
}
