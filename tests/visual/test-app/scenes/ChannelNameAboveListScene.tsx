/**
 * ChannelNameAboveListScene — renders a Column with a Text header above a
 * MessageList so Playwright can assert the header sits ABOVE the list
 * (header.bottom <= list.top).
 *
 * This scene exists purely to provide a pixel signal for the DESIRED layout.
 * The corresponding Playwright test is marked test.fixme because the current
 * SLACK_LAYOUT_FILL_CLASS forces [&>*]:!flex-row which makes siblings lay out
 * SIDE-BY-SIDE, not stacked. Fixing the layout (to allow a header above the
 * list while preserving per-list independent scroll) is a separate careful
 * change — this scene just encodes what the fixed layout should look like.
 *
 * DO NOT change SLACK_LAYOUT_FILL_CLASS here to make this scene "pass" —
 * that would re-introduce the flex-wrap/content-start regression.
 */

import React from 'react'
import {
  SLACK_LAYOUT_FILL_CLASS,
  SLACK_LIST_SCROLL_CLASS,
  SLACK_SURFACE_HOST_CLASS,
} from '@/slack/slackCatalog/logic'

export function ChannelNameAboveListScene() {
  return (
    <div
      id="panel-host"
      data-testid="panel-host"
      style={{ width: 600, height: 500 }}
      className={`min-w-0 flex-1 ${SLACK_SURFACE_HOST_CLASS}`}
    >
      {/* Column wrapper — the layout.tsx Column outer div */}
      <div data-testid="layout-column" className={SLACK_LAYOUT_FILL_CLASS}>
        {/* SDK Column interior renders "flex flex-col gap-4" containing the header + list */}
        <div className="flex flex-col gap-4">
          {/* Text header — channel name above the list */}
          <div
            id="channel-header"
            data-testid="channel-header"
            style={{ padding: '4px 12px', fontWeight: 600, fontSize: 14 }}
          >
            #general
          </div>
          {/* MessageList root */}
          <div
            id="message-list"
            data-testid="message-list"
            className={`flex w-full flex-col ${SLACK_LIST_SCROLL_CLASS}`}
          >
            {Array.from({ length: 30 }, (_, i) => (
              <div
                key={i}
                style={{ minHeight: 48, padding: '8px 12px', borderBottom: '1px solid #333' }}
              >
                Message {i + 1}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
