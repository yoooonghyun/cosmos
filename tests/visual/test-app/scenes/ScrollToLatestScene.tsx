/**
 * ScrollToLatestScene — renders a long single message list and uses
 * useSlackScrollToLatest (kind='self') so Playwright can assert the list
 * is scrolled to the bottom on first render (newest-at-bottom invariant).
 *
 * Uses the real hook from the production source — the same hook MessageList uses.
 */

import React from 'react'
import {
  SLACK_LAYOUT_FILL_CLASS,
  SLACK_LIST_SCROLL_CLASS,
  SLACK_SURFACE_HOST_CLASS,
} from '@/slack/slackCatalog/logic'
import { useSlackScrollToLatest } from '@/slack/useSlackScrollToLatest'

const ITEM_COUNT = 60

export function ScrollToLatestScene() {
  // kind='self': the ref goes on the scrollable container itself (same as MessageList)
  const scrollRef = useSlackScrollToLatest<HTMLDivElement>(ITEM_COUNT, 'self')

  return (
    <div style={{ width: 600, height: 400, display: 'flex', flexDirection: 'column' }}>
    <div
      id="panel-host"
      data-testid="panel-host"
      style={{ minHeight: 0 }}
      className={`min-w-0 flex-1 ${SLACK_SURFACE_HOST_CLASS}`}
    >
      <div data-testid="layout-column" className={SLACK_LAYOUT_FILL_CLASS}>
        <div className="flex flex-row gap-3">
          <div
            ref={scrollRef}
            id="message-list"
            data-testid="message-list"
            className={`flex w-full flex-col ${SLACK_LIST_SCROLL_CLASS}`}
          >
            {Array.from({ length: ITEM_COUNT }, (_, i) => (
              <div
                key={i}
                style={{ minHeight: 48, padding: '8px 12px', borderBottom: '1px solid #333' }}
              >
                Message {i + 1} of {ITEM_COUNT}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
    </div>
  )
}
