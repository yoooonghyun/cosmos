/*
 * glass-dock shared material config (glass-dock-v2) — the ONE tuning point for the liquid-glass
 * look every detail dock (Calendar / Jira / Confluence / Slack) wears. All four docks read these
 * SAME knobs (plus the `--glass-dock-*` color tokens in index.css), so the material stays uniform:
 * there is no per-dock divergence. Tune the glass here and every dock changes together.
 *
 * The color/fill/edge/highlight tokens stay in index.css (`:root` / `.dark`); this file owns the
 * GEOMETRY + filter knobs that the generated per-dock SVG filter consumes.
 */
/**
 * The structural shape of a glass material config. Both `GLASS_DOCK_CONFIG` (the flush docks) and
 * `OPEN_PROMPT_GLASS_CONFIG` (the rounded Open Prompt surfaces) satisfy it, so `useGlassDockFilter`
 * can accept either via one widened type instead of the literal type of a single constant.
 */
export interface GlassDockConfig {
  /** Bezel band width in CSS px. */
  bezel: number
  /** Corner radius in CSS px for the rounded rim. */
  radius: number
  /** feDisplacementMap `scale` — refraction strength. */
  displacementScale: number
  /** Light blur (px) layered after the refraction. */
  blur: number
  /** Saturate multiplier. */
  saturate: number
  /** Gaussian blur (stdDeviation) applied to the displacement map itself. */
  mapBlur: number
}

export const GLASS_DOCK_CONFIG = {
  /** Bezel band width in CSS px — how far in from each exposed edge the refraction reaches.
   *  Wider = a thicker, softer glass rim; narrower = a tighter, sharper rim. The interior beyond
   *  the bezel is perfectly neutral (crisp). */
  bezel: 22,
  /** Corner radius in CSS px for the rounded rim. The current docks are flush, square-cornered
   *  right drawers (radius 0); kept here so a future rounded dock shares one value. */
  radius: 0,
  /** feDisplacementMap `scale` — the refraction STRENGTH (max px the rim bends the backdrop).
   *  Higher = a more pronounced lens bend at the rim; the interior is unaffected (zero map there). */
  displacementScale: 38,
  /** Light blur (px) layered after the refraction so the frost reads as glass, not a sharp lens.
   *  Kept LIGHT so the bezel refraction — not a heavy frost — is the dominant glass cue. */
  blur: 12,
  /** Saturate multiplier — lifts the muted cosmos palette so the glass reads luminous, not gray. */
  saturate: 1.2,
  /** Gaussian blur (stdDeviation) applied to the displacement MAP itself inside the SVG filter, so
   *  the bezel→interior transition is softened and the rim never shows a hard step. */
  mapBlur: 0.6
} as const satisfies GlassDockConfig

/*
 * open-prompt-glass — the sibling tuning point for the fully-ROUNDED "Open Prompt" liquid-glass
 * surfaces (the expanded composer card + the collapsed logo pebble). They share the docks' material
 * CLASS (`glass-dock` fill/edge/highlight tokens) and the SAME displacement-map technique, but the
 * geometry differs enough to warrant its own knobs:
 *   - The docks are tall, flush right-drawers (radius 0, LEFT edge only). The Open Prompt surfaces
 *     are small, fully-rounded rects refracting on ALL FOUR rounded edges, so the bezel must be
 *     NARROWER (a wide 22px bezel would swallow a ~40px pebble or a short composer's whole rim) and
 *     the displacement GENTLER (a small element near a strong lens looks degenerate).
 *   - `radius` here is a DEFAULT only; the consumer overrides it per-instance with the surface's
 *     real corner radius (card `rounded-lg` ≈ 8px, logo = half its size) since the two differ.
 * Still centralised here (not inlined in PromptComposer) so the Open Prompt glass has one home.
 */
export const OPEN_PROMPT_GLASS_CONFIG = {
  /** Narrower bezel than the docks: the rounded surfaces are small, so the rim must stay a thin
   *  band that leaves a neutral interior for the textarea/glyph rather than refracting edge-to-edge. */
  bezel: 10,
  /** Default corner radius (px). Overridden per-instance by the consumer with the surface's real
   *  radius (the card and the round logo differ), so this is just a sane fallback. */
  radius: 8,
  /** Gentler refraction than the docks (38): a strong lens bend on a tiny element reads degenerate;
   *  this keeps the all-edges rounded rim a tasteful subtle bend. */
  displacementScale: 16,
  /** Same light frost as the docks so the two materials read as one family. */
  blur: 12,
  saturate: 1.2,
  mapBlur: 0.6
} as const satisfies GlassDockConfig
