/*
 * <GlassDock/> (glass-dock-v2) — the single reusable liquid-glass dock surface every detail dock
 * (Calendar / Jira / Confluence / Slack) wears. It bundles the shared `glass-dock` material class,
 * the per-instance refraction filter from `useGlassDockFilter` (a displacement map sized to THIS
 * dock with a neutral interior + bezel-only rim refraction), and renders the injected SVG filter.
 *
 * One component => one look + one tuning point (GLASS_DOCK_CONFIG + the `--glass-dock-*` tokens):
 * no dock diverges. A dock supplies its own positioning/size classes (e.g.
 * `absolute inset-y-0 right-0 …`) via `className`; GlassDock prepends `glass-dock` and wires the
 * measured backdrop-filter.
 *
 * Edges default to the right-drawer rim (LEFT edge only) since all four current docks are flush
 * right-edge drawers; pass `edges` to override for a future rounded/other-edge dock.
 */
import React, { type ReactNode } from 'react'
import type { ExposedEdges } from './displacementMap'
import { useGlassDockFilter } from './useGlassDockFilter'

export interface GlassDockProps {
  /** Positioning/sizing classes for the drawer (NOT the material — `glass-dock` is added). */
  className?: string
  /** Which edges refract; defaults to the right-drawer LEFT-only rim. */
  edges?: ExposedEdges
  children?: ReactNode
  /** Optional aria-label / role passthrough kept minimal; docks usually label their inner content. */
  'aria-label'?: string
}

export function GlassDock({
  className,
  edges,
  children,
  ...rest
}: GlassDockProps): React.JSX.Element {
  const { ref, style, filter } = useGlassDockFilter(edges)
  return (
    <div
      ref={ref as (el: HTMLDivElement | null) => void}
      className={className ? `glass-dock ${className}` : 'glass-dock'}
      style={style}
      {...rest}
    >
      {filter}
      {children}
    </div>
  )
}
