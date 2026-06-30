/**
 * slackSurfaceBuilder (main) — the pure Slack bound-shell / row helpers live in the SHARED
 * module `src/shared/surfaceBuilders/slackSurfaceBuilder.ts`. This file RE-EXPORTS them
 * (single source of truth; the main resolver/dispatcher imports are unchanged) and keeps
 * the MAIN-ONLY `buildSlackBoundShell` (panel-refresh-v1) here.
 */

import type { A2uiSurfaceUpdate } from '../../shared/ipc'
import { SlackAdapterSource } from '../../shared/types/slack'
import {
  boundListSpec,
  SLACK_CHANNELS_PATH,
  SLACK_MATCHES_PATH,
  SLACK_MESSAGES_PATH,
  SURFACE_SLACK_CHANNELS,
  SURFACE_SLACK_HISTORY,
  SURFACE_SLACK_SEARCH
} from '../../shared/surfaceBuilders/slackSurfaceBuilder'

// Re-export the relocated pure row mappers + constants (single source of truth).
export {
  slackChannelRow,
  slackMessageRow,
  slackSearchRow,
  SLACK_CHANNELS_PATH,
  SLACK_MESSAGES_PATH,
  SLACK_MATCHES_PATH,
  SURFACE_SLACK_CHANNELS,
  SURFACE_SLACK_HISTORY,
  SURFACE_SLACK_SEARCH
} from '../../shared/surfaceBuilders/slackSurfaceBuilder'

/**
 * panel-refresh-v1 (OQ-5 = main-composes): build the DATA-FREE bound SHELL surface for a
 * Slack `dataSource`, so main can push a `{path}`-bound surface (instead of the agent's
 * literal-prop spec) and then let the AdapterDispatcher's first `refresh` paint it in
 * place. The shell carries no data — just the bound root reading the reserved paths the
 * dispatcher writes. Returns `null` for a non-Slack source. The surfaceId is stable per
 * source so a later refresh's `updateDataModel` (keyed by surfaceId) lands here.
 */
export function buildSlackBoundShell(dataSource: string): A2uiSurfaceUpdate | null {
  switch (dataSource) {
    case SlackAdapterSource.ListChannels:
      return boundListSpec(SURFACE_SLACK_CHANNELS, 'ChannelList', 'channels', SLACK_CHANNELS_PATH)
    case SlackAdapterSource.GetHistory:
      return boundListSpec(SURFACE_SLACK_HISTORY, 'MessageList', 'messages', SLACK_MESSAGES_PATH)
    case SlackAdapterSource.Search:
      return boundListSpec(SURFACE_SLACK_SEARCH, 'SearchResultList', 'matches', SLACK_MATCHES_PATH)
    default:
      return null
  }
}
