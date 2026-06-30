/**
 * nativeMirror — PURE renderer helpers that project a native-first panel's CURRENT native view
 * into a favorite-only mirror {@link TabSurface} (cosmos-native-view-mirror-surface-v1, D4).
 * Framework-free + node-testable (no React/DOM import — only erased `import type`s + the SHARED,
 * secret-free bound-surface builders), per the `.ts`/`.test.ts` split.
 *
 * Each panel lifts its active tab's on-screen native data (OQ-2 — no refetch) and selects the
 * current view; this module maps that view to the matching SHARED bound builder, then WRAPS the
 * `{spec, dataModel, descriptor}` into a {@link TabSurface} with a FRESH `requestId` per build.
 *
 * DISPLAY-ONLY (OQ-3 / FR-012): the mirror is a re-projection of the source's current dataset,
 * rebuilt whenever the source's native view changes — NOT a live-updated bound surface (no
 * main-side region registration is implied; the favorite's own load-more would be warn-ignored).
 * A fresh `requestId` each build makes every rebuild a new surface instance. Returns `null` when
 * the native view has no data yet (→ the favorite shows the calm WAITING placeholder, FR-008).
 *
 * NON-SECRET (FR-006): the builders' output is an A2UI spec + a secret-free descriptor + a
 * non-secret data-model seed — never a token, path, or transcript.
 */

import type { TabSurface } from '../tabs/useGenerativePanelTabs'
import type {
  ConfluencePage,
  ConfluencePageDetail,
  ConfluenceSearchResult
} from '../../shared/types/confluence'
import type {
  SlackChannel,
  SlackMessage,
  SlackPage,
  SlackSearchMatch
} from '../../shared/types/slack'
import {
  buildBoundDefaultFeedSurface,
  buildBoundPageDetailSurface,
  buildBoundSearchResultsSurface,
  type ConfluenceBoundSurface
} from '../../shared/surfaceBuilders/confluenceSurfaceBuilder'
import {
  buildBoundChannelListSurface,
  buildBoundMessageListSurface,
  buildBoundSearchResultListSurface,
  type SlackBoundSurface
} from '../../shared/surfaceBuilders/slackSurfaceBuilder'

/** A function that mints a fresh requestId per built surface. Injectable for deterministic tests. */
export type MintRequestId = () => string

let mirrorSeq = 0
/** The default requestId minter for a display-only re-projection (uniqueness is all that matters). */
export function mintMirrorRequestId(): string {
  mirrorSeq += 1
  return `mirror-${Date.now().toString(36)}-${mirrorSeq}`
}

/**
 * The lifted CURRENT Confluence native view for the active tab (OQ-3): a page open in the dock,
 * else an active search, else the default feed. `null` ⇒ no native view to mirror (→ WAITING).
 */
export type ConfluenceMirrorView =
  | { kind: 'page'; detail: ConfluencePageDetail }
  | { kind: 'search'; query: string; page: ConfluencePage<ConfluenceSearchResult> }
  | { kind: 'feed'; page: ConfluencePage<ConfluenceSearchResult> }
  | null

/**
 * The lifted CURRENT Slack native view for the active tab (OQ-3): an open channel's history, an
 * active message search, else the channel list. `null` ⇒ no native view to mirror (→ WAITING).
 */
export type SlackMirrorView =
  | { kind: 'channels'; page: SlackPage<SlackChannel> }
  | { kind: 'history'; channelId: string; page: SlackPage<SlackMessage> }
  | { kind: 'search'; query: string; page: SlackPage<SlackSearchMatch> }
  | null

/** Wrap a built bound surface into a display-only {@link TabSurface} with a fresh requestId. */
function toMirrorSurface(
  built: ConfluenceBoundSurface | SlackBoundSurface,
  mintId: MintRequestId
): TabSurface {
  return {
    requestId: mintId(),
    spec: built.spec,
    dataModel: built.dataModel,
    descriptor: built.descriptor
  }
}

/**
 * Build the Confluence favorite mirror for the lifted native view, or `null` when there is no
 * native data yet. Reuses `buildBoundPageDetailSurface` / `buildBoundSearchResultsSurface` /
 * `buildBoundDefaultFeedSurface` (FR-003).
 */
export function buildConfluenceMirror(
  view: ConfluenceMirrorView,
  mintId: MintRequestId = mintMirrorRequestId
): TabSurface | null {
  if (!view) {
    return null
  }
  if (view.kind === 'page') {
    return toMirrorSurface(buildBoundPageDetailSurface(view.detail), mintId)
  }
  if (view.kind === 'search') {
    return toMirrorSurface(buildBoundSearchResultsSurface(view.query, view.page), mintId)
  }
  return toMirrorSurface(buildBoundDefaultFeedSurface(view.page), mintId)
}

/**
 * Build the Slack favorite mirror for the lifted native view, or `null` when there is no native
 * data yet. Reuses `buildBoundChannelListSurface` / `buildBoundMessageListSurface` (with the
 * non-secret `channelId`) / `buildBoundSearchResultListSurface` (FR-004).
 */
export function buildSlackMirror(
  view: SlackMirrorView,
  mintId: MintRequestId = mintMirrorRequestId
): TabSurface | null {
  if (!view) {
    return null
  }
  if (view.kind === 'history') {
    return toMirrorSurface(buildBoundMessageListSurface(view.channelId, view.page), mintId)
  }
  if (view.kind === 'search') {
    return toMirrorSurface(buildBoundSearchResultListSurface(view.query, view.page), mintId)
  }
  return toMirrorSurface(buildBoundChannelListSurface(view.page), mintId)
}
