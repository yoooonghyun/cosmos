/**
 * confluenceCatalog/layout — clamped Column/Row wrappers for the Confluence custom A2UI
 * catalog (bug slack-generative-wrap-v1, Confluence latent instance).
 *
 * The agent groups Confluence lists/detail with the SDK standard-catalog `Column`/`Row`.
 * Those SDK containers render a `<div className="flex flex-col gap-4">` / `"flex flex-row
 * gap-3">` with NO `min-w-0`, so the flex box keeps `min-width: auto` and grows to its
 * content's intrinsic width — a long unbroken line then expands it past the panel and
 * overflows horizontally instead of wrapping (the leaf's `break-words` and the list root's
 * `min-w-0` cannot take effect once their containing block is already wider than the panel).
 *
 * We cannot change the third-party SDK div's className, so these wrappers render the SDK
 * `Column`/`Row` inside a block box carrying {@link CONFLUENCE_LAYOUT_CLAMP_CLASS}
 * (`w-full min-w-0 max-w-full`). That box is bounded by the panel width, and the SDK flex
 * `<div>` is a block-level child bounded by it — so its `min-w-0` list-root descendants
 * finally wrap. Purely a width clamp; all SDK behavior (children-by-id, justify/align/weight,
 * template binding) is forwarded verbatim.
 *
 * Registered in `index.ts` in place of the raw `standardCatalog.components.Column/Row`.
 */

import { standardCatalog } from '@a2ui-sdk/react/0.9'
import { CONFLUENCE_LAYOUT_CLAMP_CLASS } from './logic'

const SdkColumn = standardCatalog.components.Column
const SdkRow = standardCatalog.components.Row

/** The SDK Column, wrapped in the generative-wrap width clamp. Props forwarded verbatim. */
export function Column(props: React.ComponentProps<typeof SdkColumn>): React.JSX.Element {
  return (
    <div className={CONFLUENCE_LAYOUT_CLAMP_CLASS}>
      <SdkColumn {...props} />
    </div>
  )
}

/** The SDK Row, wrapped in the generative-wrap width clamp. Props forwarded verbatim. */
export function Row(props: React.ComponentProps<typeof SdkRow>): React.JSX.Element {
  return (
    <div className={CONFLUENCE_LAYOUT_CLAMP_CLASS}>
      <SdkRow {...props} />
    </div>
  )
}
