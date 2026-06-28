/**
 * PerListScrollScene — renders two message lists inside the REAL
 * SLACK_LAYOUT_FILL_CLASS / SLACK_LIST_SCROLL_CLASS CSS chain so Playwright
 * can assert the side-by-side / independent-scroll invariants.
 *
 * We do NOT use the SDK-bound MessageList (which needs a live surfaceId data
 * model). Instead we replicate the exact DOM structure the chain threads through:
 *
 *   host (SLACK_SURFACE_HOST_CLASS + panel dims)
 *     └─ Column wrapper (SLACK_LAYOUT_FILL_CLASS)          ← layout.tsx Column
 *          └─ sdk-row div (flex flex-row gap-3)            ← SDK Row interior
 *               ├─ list-A (SLACK_LIST_SCROLL_CLASS)        ← MessageList root
 *               │    └─ 40 tall message items
 *               └─ list-B (SLACK_LIST_SCROLL_CLASS)
 *                    └─ 40 tall message items
 *
 * This is IDENTICAL to what the real components produce; the chain is the thing
 * under test, not the SDK data binding. Any change that breaks the invariants
 * (e.g. adding flex-wrap/content-start) will make this test go RED.
 */

import React from 'react'
import {
  SLACK_LAYOUT_FILL_CLASS,
  SLACK_LIST_SCROLL_CLASS,
  SLACK_SURFACE_HOST_CLASS,
} from '@/slack/slackCatalog/logic'

/** One tall list of N stub message rows — enough to overflow its container */
function StubMessageList({ id, count = 40 }: { id: string; count?: number }) {
  return (
    <div
      id={id}
      data-testid={id}
      // MessageList root: the class that consumes the flex-fill chain + provides per-list scroll
      className={`flex w-full flex-col ${SLACK_LIST_SCROLL_CLASS}`}
    >
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          style={{ minHeight: 48, padding: '8px 12px', borderBottom: '1px solid #333' }}
        >
          Message {i + 1} in {id}
        </div>
      ))}
    </div>
  )
}

export function PerListScrollScene() {
  return (
    // Outer fixture shell: a fixed-size block that gives the flex chain a definite height.
    // This mirrors the role of the SlackPanel's parent (@container/slackbody flex min-h-0 flex-1)
    // which provides the resolved height the fill chain needs in the real app.
    <div style={{ width: 800, height: 600, display: 'flex', flexDirection: 'column' }}>
    {/* Host: the SlackPanel tabpanel — min-w-0 flex-1 + SLACK_SURFACE_HOST_CLASS */}
    <div
      id="panel-host"
      data-testid="panel-host"
      style={{ minHeight: 0 }}
      // Mirrors the SlackPanel tabpanel: existing min-w-0 flex-1 + SLACK_SURFACE_HOST_CLASS
      className={`min-w-0 flex-1 ${SLACK_SURFACE_HOST_CLASS}`}
    >
      {/* Column wrapper: SLACK_LAYOUT_FILL_CLASS — the layout.tsx Column wrapper div */}
      <div data-testid="layout-column" className={SLACK_LAYOUT_FILL_CLASS}>
        {/*
         * SDK Row interior: "flex flex-row gap-3" (what SdkRow renders).
         * The [&>*] selector on SLACK_LAYOUT_FILL_CLASS forces this to flex-row
         * (via !flex-row) and gives it min-h-0 + flex-1.
         * We render the SDK interior div directly (matches the real DOM exactly).
         */}
        <div className="flex flex-row gap-3">
          <StubMessageList id="list-a" />
          <StubMessageList id="list-b" />
        </div>
      </div>
    </div>
    </div>
  )
}
