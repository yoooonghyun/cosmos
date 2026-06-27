/*
 * useGlassDockFilter / GlassDockFilter (glass-dock-v2) — the React layer that gives a detail
 * dock its per-instance liquid-glass refraction filter.
 *
 * Why per-instance + sized-to-element: an SVG `<feImage>` displacement map does NOT scale to the
 * filter region — it draws at its own pixel size, so a map that does not match the element either
 * tiles or clips. The OLD single static `#glass-dock-distortion` filter (a size-agnostic
 * feTurbulence) sidestepped sizing but, being random noise, distorted the whole backdrop and read
 * broken. Here each open dock gets its OWN filter whose displacement map is generated AT the dock's
 * measured size and REGENERATED on resize, so the bezel refraction stays pinned to the real rim.
 *
 * Usage (each of the four docks):
 *   const { ref, style } = useGlassDockFilter()
 *   <div ref={ref} className="glass-dock …" style={style}>…</div>
 * `style.backdropFilter` points at this instance's `url(#glass-dock-<uid>)` filter; the injected
 * <svg><filter> is rendered by the returned <GlassDockFilterSvg/> (the hook mounts it for you).
 *
 * Only ONE dock is open at a time in practice, the map regenerates only on resize (debounced), and
 * the whole thing is Chromium-only (SVG backdrop-filter) — all acceptable in Electron.
 */
import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from 'react'
import { GLASS_DOCK_CONFIG, type GlassDockConfig } from './config'
import type { ExposedEdges, GlassDockGeometry } from './displacementMap'
import { generateDisplacementMapDataUrl } from './generateDisplacementMap'

/** The four docks are full-height right-edge drawers flush to the right window edge: only their
 *  LEFT edge is an interior rim that meets the backdrop, so only the LEFT refracts. (Top/bottom sit
 *  against the panel chrome, right sits against the window — refracting them would draw a box.) */
export const RIGHT_DRAWER_EDGES: ExposedEdges = {
  left: true,
  right: false,
  top: false,
  bottom: false
}

/** A fully-rounded surface (the Open Prompt card + logo pebble) refracts on ALL FOUR edges, so the
 *  bezel sweeps the whole rounded-rect rim (radius supplied per-instance via `radius`). */
export const ALL_EDGES: ExposedEdges = {
  left: true,
  right: true,
  top: true,
  bottom: true
}

const RESIZE_DEBOUNCE_MS = 100

/**
 * Tuning for one glass instance. `edges` picks which rims refract (default: the right-drawer
 * LEFT-only rim). `config` swaps the whole knob set (bezel/scale/blur/…) — the docks use the
 * default `GLASS_DOCK_CONFIG`; the rounded Open Prompt surfaces pass `OPEN_PROMPT_GLASS_CONFIG`.
 * `radius` overrides JUST the corner radius per-instance (the card and the round logo differ, so a
 * shared config radius can't cover both) while keeping the rest of `config`. Backwards-compatible:
 * an omitted-options or `ExposedEdges`-only call behaves exactly as before.
 */
export interface GlassFilterOptions {
  edges?: ExposedEdges
  config?: GlassDockConfig
  /** Per-instance corner radius (px) overriding `config.radius`; for fully-rounded surfaces. */
  radius?: number
}

/** Normalise the legacy `edges`-only arg or the new options object into a concrete options set. */
function resolveOptions(arg: ExposedEdges | GlassFilterOptions | undefined): {
  edges: ExposedEdges
  config: GlassDockConfig
  radius: number
} {
  // An `ExposedEdges` has the four boolean edge keys; the options object never does.
  if (arg && 'left' in arg && typeof (arg as ExposedEdges).left === 'boolean') {
    return { edges: arg as ExposedEdges, config: GLASS_DOCK_CONFIG, radius: GLASS_DOCK_CONFIG.radius }
  }
  const opts = (arg as GlassFilterOptions | undefined) ?? {}
  const config = opts.config ?? GLASS_DOCK_CONFIG
  return {
    edges: opts.edges ?? RIGHT_DRAWER_EDGES,
    config,
    radius: opts.radius ?? config.radius
  }
}

export interface UseGlassDockFilterResult {
  /** Attach to the dock element so it can be measured. */
  ref: (el: HTMLElement | null) => void
  /** Spread onto the dock element: sets `backdrop-filter` to this instance's generated filter
   *  (refraction → light blur → saturate), with a plain blur fallback until the map is ready. */
  style: CSSProperties
  /** The injected per-instance `<svg><filter>` element — render it anywhere inside the dock. */
  filter: React.JSX.Element | null
}

/**
 * Measure a dock element, generate its displacement map on size change (debounced), and expose
 * the `backdrop-filter` style + the SVG filter element. Edges default to the right-drawer rim.
 */
export function useGlassDockFilter(
  arg: ExposedEdges | GlassFilterOptions = RIGHT_DRAWER_EDGES
): UseGlassDockFilterResult {
  // Accept either the legacy `edges`-only arg (the docks) or an options object that can also swap
  // the config + override the per-instance radius (the rounded Open Prompt surfaces).
  const { edges, config: cfg, radius } = resolveOptions(arg)
  // A DOM-id-safe unique filter id for this instance.
  const filterId = `glass-dock-${useId().replace(/[:]/g, '')}`

  const elRef = useRef<HTMLElement | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  // Regenerate the displacement map for the current size.
  const regenerate = useCallback(
    (width: number, height: number): void => {
      if (width <= 0 || height <= 0) return
      const geom: GlassDockGeometry = {
        width,
        height,
        radius,
        bezel: cfg.bezel,
        edges
      }
      setDataUrl(generateDisplacementMapDataUrl(geom))
      setSize({ width, height })
    },
    [radius, cfg.bezel, edges]
  )

  const ref = useCallback(
    (el: HTMLElement | null) => {
      elRef.current = el
      // Tear down a prior observer when the element changes / unmounts.
      if (observerRef.current) {
        observerRef.current.disconnect()
        observerRef.current = null
      }
      if (!el || typeof ResizeObserver === 'undefined') return

      // Measure immediately so the first paint has a correctly-sized map.
      const rect = el.getBoundingClientRect()
      regenerate(rect.width, rect.height)

      const observer = new ResizeObserver((entries) => {
        const entry = entries[0]
        if (!entry) return
        const { width, height } = entry.contentRect
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => regenerate(width, height), RESIZE_DEBOUNCE_MS)
      })
      observer.observe(el)
      observerRef.current = observer
    },
    [regenerate]
  )

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (observerRef.current) observerRef.current.disconnect()
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  // The dock's backdrop-filter. Until the displacement map is ready (or if no canvas is
  // available), the refraction is simply absent and the dock wears a plain frosted blur — the
  // material still reads as glass, it just lacks the rim bend for that frame.
  const style = useMemo<CSSProperties>(() => {
    const blurSat = `blur(${cfg.blur}px) saturate(${cfg.saturate})`
    const value = dataUrl ? `url(#${filterId}) ${blurSat}` : blurSat
    return {
      backdropFilter: value,
      WebkitBackdropFilter: value
    } as CSSProperties
  }, [dataUrl, filterId, cfg.blur, cfg.saturate])

  const filter = useMemo<React.JSX.Element | null>(() => {
    if (!dataUrl || !size) return null
    return (
      <GlassDockFilterSvg
        id={filterId}
        href={dataUrl}
        width={size.width}
        height={size.height}
        scale={cfg.displacementScale}
        mapBlur={cfg.mapBlur}
      />
    )
  }, [dataUrl, size, filterId, cfg.displacementScale, cfg.mapBlur])

  return { ref, style, filter }
}

interface GlassDockFilterSvgProps {
  id: string
  href: string
  width: number
  height: number
  scale: number
  mapBlur: number
}

/**
 * The injected per-instance SVG filter. `feImage` draws the displacement map at the dock's exact
 * size (so it neither tiles nor clips); `feDisplacementMap` bends the backdrop by the map's R/G
 * channels; a tiny `feGaussianBlur` on the map softens the bezel→interior seam. Hidden, zero
 * layout footprint, non-interactive — purely a filter definition.
 */
function GlassDockFilterSvg({
  id,
  href,
  width,
  height,
  scale,
  mapBlur
}: GlassDockFilterSvgProps): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      width="0"
      height="0"
      style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }}
    >
      <filter
        id={id}
        x="0%"
        y="0%"
        width="100%"
        height="100%"
        colorInterpolationFilters="sRGB"
      >
        <feImage
          href={href}
          x="0"
          y="0"
          width={width}
          height={height}
          result="dispMap"
          preserveAspectRatio="none"
        />
        <feGaussianBlur in="dispMap" stdDeviation={mapBlur} result="dispBlur" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="dispBlur"
          scale={scale}
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </svg>
  )
}
