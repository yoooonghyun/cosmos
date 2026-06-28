/**
 * contextChipIcons — the SHARED per-kind glyph + accessible-noun maps for the in-view item
 * (the dock dimension), lifted out of `ContextChip.tsx` so BOTH the composer `ContextChip` and
 * the timeline `PromptContextChip` (cosmos-timeline-prompt-context-v1, design §6) import the ONE
 * source rather than duplicating it.
 *
 * Keyed by the {@link ContextChipData} primary kind (`jira` / `slack-channel` / `confluence` /
 * `calendar`). The icons echo each panel's own glyph (composer design §3); the nouns are the
 * ARIA-label prefix (composer design §8). Value-only module (lucide component references) — no JSX.
 */
import { Calendar, FileText, Hash, Ticket } from 'lucide-react'
import type { ItemContextChip } from './viewContextCapture'

/** The primary (dock-item) chip kind shared by the composer + timeline chips. */
export type PrimaryChipKind = ItemContextChip['primary']['kind']

/** The lucide icon used for each primary chip kind (echoes each panel's own glyph). */
export const PRIMARY_ICON = {
  jira: Ticket,
  'slack-channel': Hash,
  confluence: FileText,
  calendar: Calendar
} as const satisfies Record<PrimaryChipKind, React.ComponentType<{ className?: string }>>

/** An accessible-label prefix per primary kind. */
export const PRIMARY_NOUN = {
  jira: 'Jira issue',
  'slack-channel': 'Slack channel',
  confluence: 'Confluence page',
  calendar: 'Calendar event'
} as const satisfies Record<PrimaryChipKind, string>
