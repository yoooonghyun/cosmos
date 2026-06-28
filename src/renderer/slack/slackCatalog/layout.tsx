/**
 * slackCatalog/layout — clamped Column/Row wrappers for the Slack custom A2UI catalog
 * (bug slack-generative-wrap-v1).
 *
 * The agent groups Slack lists with the SDK standard-catalog `Column`/`Row`. Those SDK
 * containers render a `<div className="flex flex-col gap-4">` / `"flex flex-row gap-3">`
 * with NO `min-w-0`, so the flex box keeps `min-width: auto` and grows to its content's
 * intrinsic width — a long unbroken message line then expands it past the panel and
 * overflows horizontally instead of wrapping (the leaf `<p>`'s `break-words` and the
 * list root's `min-w-0` cannot take effect once their containing block is already wider
 * than the panel).
 *
 * We cannot change the third-party SDK div's className, so these wrappers render the SDK
 * `Column`/`Row` inside a block box carrying {@link SLACK_LAYOUT_FILL_CLASS}. That class
 * repairs BOTH axes at this one renderer-owned seam:
 *   - HORIZONTAL (unchanged, bug slack-generative-wrap-v1): the `w-full min-w-0 max-w-full`
 *     width clamp bounds the box to the panel width so the SDK flex `<div>` is a block-level
 *     child whose `min-w-0` list-root descendants (MessageList/SearchResultList/ChannelList)
 *     finally wrap instead of overflowing.
 *   - VERTICAL (slack-list-scroll-fill-v2): `flex flex-col min-h-0 flex-1` makes the wrapper a
 *     fill link, and the positional `[&>*]` selector repairs the auto-height SDK flex child (the
 *     wrapper's only child) so the definite-height / flex-fill chain threads through it down to
 *     the list roots — a lone list fills the panel, N lists equal-split + each scroll. `[&>*]`
 *     keys off DOM position, not any SDK class, so an SDK markup change can't silently re-break it.
 *
 * All SDK behavior (children-by-id, justify/align/weight, template binding) is forwarded verbatim.
 * Registered in `index.ts` in place of the raw `standardCatalog.components.Column/Row`.
 */

import { standardCatalog } from '@a2ui-sdk/react/0.9'
import { SLACK_LAYOUT_FILL_CLASS } from './logic'

const SdkColumn = standardCatalog.components.Column
const SdkRow = standardCatalog.components.Row

/** The SDK Column, wrapped in the generative-wrap clamp + v2 fill chain. Props forwarded verbatim. */
export function Column(props: React.ComponentProps<typeof SdkColumn>): React.JSX.Element {
  return (
    <div className={SLACK_LAYOUT_FILL_CLASS}>
      <SdkColumn {...props} />
    </div>
  )
}

/** The SDK Row, wrapped in the generative-wrap clamp + v2 fill chain. Props forwarded verbatim. */
export function Row(props: React.ComponentProps<typeof SdkRow>): React.JSX.Element {
  return (
    <div className={SLACK_LAYOUT_FILL_CLASS}>
      <SdkRow {...props} />
    </div>
  )
}
