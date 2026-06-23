/**
 * SlackMessageRow — the ONE canonical Slack message-row presentation
 * (slack-generative-message-parity-v1, OQ-3 = full unification, FR-017). Imported by BOTH
 * the native Slack panel (`SlackPanel.tsx`) and the generated catalog node
 * (`slackCatalog/components.tsx`) so wrap/author/timestamp/reply presentation can NEVER
 * silently diverge again. The native row becomes a thin adapter spreading `message.*` in;
 * the catalog row wraps it and supplies `onOpenThread` only when thread coords are present.
 *
 * Purely presentational: NO data fetching, NO `useBound`/SDK hooks. The only behavioral
 * input is `onOpenThread` — its presence + a positive `replyCount` turns the replies
 * affordance interactive (design §2.2/§3). The wrap fix (design §4) lives partly here: the
 * row clamps its own width (`w-full min-w-0`) and the body column is `min-w-0 flex-1` so the
 * per-`<p>` `break-words` has a real containing block.
 *
 * Design trace: §2.1 exact classes, §2.2 shared-row props, §3 replies affordance states.
 */

import { useState } from 'react'
import { Maximize2 } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { authorName, countLabel, formatTs, initials, shouldOpenThreadOnRowClick } from './logic'
import { parseMessageRuns } from './messageContent'
import { SlackImageViewer } from './SlackImageViewer'
import { SlackMessageImage } from './SlackMessageImage'
import type { SlackImageRef } from '../../shared/slack'

/**
 * The shared-row presentation contract (design §2.2) — a plain props object, NOT a
 * `SlackMessage` and NOT SDK `SdkProps`. Every field traces to an existing native/catalog
 * row prop. `onOpenThread` is the one behavioral input.
 */
export interface SlackMessageRowProps {
  ts?: string
  userId?: string
  userName?: string
  text?: string
  replyCount?: number
  /**
   * Per-message custom-emoji shortcode → opaque `cosmos-slack-img://` ref map
   * (slack-rich-message-render-v1, FR-006/FR-007). A `:name:` marker in `text` whose
   * shortcode is here renders as an inline image; others stay literal. Absent → none.
   */
  customEmoji?: Record<string, string>
  /**
   * Inline image attachments as opaque refs (FR-009/FR-010). Rendered as a thumbnail strip
   * below the body. Absent / empty → no thumbnails.
   */
  images?: SlackImageRef[]
  /**
   * The channel a SEARCH hit belongs to (bug slack-search-shared-row-v1, Issue 2). Search
   * results span channels, so a hit shows a `#channelName` context chip beside the author —
   * the ONLY presentational difference from a same-channel history row. Channel-history /
   * thread rows omit it (the channel is implied by the view). Non-secret display label.
   */
  channelName?: string
  /**
   * When present (thread coords carried, native drill-in wired), the WHOLE ROW becomes an
   * open-thread trigger and the "N replies" affordance is interactive
   * (slack-thread-order-and-empty-reply-v1, Bug 2: a reply-less message must still open its
   * thread so the user can post the first reply). Absent → a plain, non-interactive row + the
   * muted "N replies" label only (FR-012).
   */
  onOpenThread?: () => void
}

/**
 * Whether a row click should open the thread (slack-thread-order-and-empty-reply-v1, Bug 2;
 * fixed in bug slack-thread-open-click-v1). Opening on EVERY click would swallow normal
 * interactions, so ignore a click that is part of a text SELECTION or that lands on a nested
 * interactive element (a link, button, image, or inner `[role=button]` — the image thumbnails
 * + replies affordance own their own click).
 *
 * `row` is the row element itself (`e.currentTarget`). It MUST be excluded from the
 * nested-interactive walk: the row carries `role="button"` (the whole row is the trigger), so
 * `target.closest('[role="button"]')` would otherwise match the ROW on EVERY plain click and
 * wrongly short-circuit it (the original bug — thread never opened). We walk up from the click
 * target but treat a match equal to `row` as NOT nested. The selection/decision split lives in
 * `logic.ts` (`shouldOpenThreadOnRowClick`) so it is node-testable. Pure + total.
 */
function isPlainRowClick(target: EventTarget | null, row: Element): boolean {
  const sel = typeof window !== 'undefined' ? window.getSelection?.() : null
  const hasTextSelection = !!sel && sel.type === 'Range' && sel.toString() !== ''
  let onNestedInteractive = false
  if (target instanceof Element) {
    const hit = target.closest('a, button, img, [role="button"]')
    // The row itself satisfies `[role="button"]`; a match equal to the row is NOT a nested
    // control, so exclude it. Only a STRICTLY nested control (a real descendant) bails.
    onNestedInteractive = hit !== null && hit !== row
  }
  return shouldOpenThreadOnRowClick(hasTextSelection, onNestedInteractive)
}

/**
 * Render a message body as ordered runs (slack-rich-message-render-v1, Track E): plain text
 * segments verbatim (preserving newlines via `whitespace-pre-wrap`) interleaved with inline
 * custom-emoji `<img>`s at text scale. A broken custom-emoji image falls back to its literal
 * `:shortcode:` (the `alt`). When there are no custom emoji the body is a single text run.
 */
function MessageBody({
  text,
  customEmoji
}: {
  text?: string
  customEmoji?: Record<string, string>
}): React.JSX.Element {
  const runs = parseMessageRuns(text ?? '', customEmoji)
  return (
    <p className="whitespace-pre-wrap break-words text-sm text-card-foreground">
      {runs.map((run, i) =>
        run.kind === 'custom-emoji' ? (
          <img
            key={i}
            src={run.ref}
            alt={`:${run.shortcode}:`}
            title={`:${run.shortcode}:`}
            className="inline-block h-[1.25em] w-auto translate-y-[0.15em] align-baseline"
          />
        ) : (
          run.text
        )
      )}
    </p>
  )
}

/**
 * The inline image-attachment thumbnail strip (FR-009/FR-010 + thread-sidepanel v1
 * FR-008/FR-010). Each opaque ref is the child of a real `<button>` so it is a keyboard-
 * operable control that opens the in-app image viewer on the CLICKED image (design §3).
 * `onView(img)` lifts the click to the row, which owns the single viewer `Dialog`. main
 * resolves the ref with the token; the renderer only holds the opaque ref. Each thumbnail
 * is a `SlackMessageImage` that shows a loading skeleton until `onLoad` and an `ImageOff`
 * "image unavailable" placeholder on a failed fetch (slack-image-skeleton-placeholder-v1) —
 * no crash, no layout shift, the rest of the row renders. Returns null when there are no
 * images.
 */
function MessageImages({
  images,
  onView
}: {
  images?: SlackImageRef[]
  onView: (img: SlackImageRef) => void
}): React.JSX.Element | null {
  if (!Array.isArray(images) || images.length === 0) {
    return null
  }
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {images.map((img, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onView(img)}
          aria-label={`View image${img.alt ? `: ${img.alt}` : ''}`}
          className="group relative overflow-hidden rounded-md border border-border/60 transition-colors hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card"
        >
          <SlackMessageImage img={img} />
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/30 group-focus-visible:bg-black/30">
            <Maximize2 className="size-4 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
          </span>
        </button>
      ))}
    </div>
  )
}

/**
 * The replies affordance (design §3) — a "N replies" label.
 *
 * It is NOT itself focus-interactive (bug slack-replies-focus-thread-scroll-v1, Defect 1):
 * the WHOLE ROW is the open-thread trigger (role="button" + the row's onClick, from #88/#95),
 * so a separate tab stop / focus ring on this sub-element is redundant. When `onOpenThread`
 * is wired we style the label as a clickable affordance (primary color, hover underline) and
 * the row-level click opens the thread — but it carries NO `tabIndex`, NO `role`, and is NOT
 * a `<button>`, so it is never an independent focus target. When `onOpenThread` is absent it
 * is the plain muted metadata label (graceful degradation, FR-012). `replyCount <= 0` → null.
 */
function RepliesAffordance({
  replyCount,
  onOpenThread
}: {
  replyCount?: number
  onOpenThread?: () => void
}): React.JSX.Element | null {
  if (typeof replyCount !== 'number' || replyCount <= 0) {
    // §3.3: zero/absent reply count → render nothing (no control, no label, no gap).
    return null
  }
  const label = countLabel(replyCount, 'reply', 'replies')
  if (!onOpenThread) {
    // §3.2: no thread coords → non-interactive metadata label (graceful degradation, FR-012).
    return <p className="text-xs text-muted-foreground">{label}</p>
  }
  // §3.1: plain non-interactive label. The thread opens via the ROW's onClick; this sub-element
  // has no hover/cursor/focus affordance of its own (no tab stop, no mouseover styling). Plain
  // text node, so `isPlainRowClick` does NOT treat it as a nested control — the row's onClick
  // fires and opens the thread (bug slack-replies-focus-thread-scroll-v1).
  return <p className="text-xs font-medium text-muted-foreground">{label}</p>
}

/**
 * The canonical Slack message row (design §2.1). avatar · name(truncate) · timestamp ·
 * wrapped body · replies affordance. `w-full min-w-0` is the wrap fix's row-level clamp.
 */
export function SlackMessageRow({
  ts,
  userId,
  userName,
  text,
  replyCount,
  customEmoji,
  images,
  channelName,
  onOpenThread
}: SlackMessageRowProps): React.JSX.Element {
  const name = authorName(userId ?? '', userName)
  // Row-local image-viewer state (thread-sidepanel v1, FR-008): the clicked thumbnail's
  // opaque ref, or null when the viewer is closed. Owning it here means BOTH the native and
  // generative surfaces get the viewer for free (the row is the one shared presentation).
  const [viewing, setViewing] = useState<SlackImageRef | null>(null)
  // slack-thread-order-and-empty-reply-v1 (Bug 2): the whole row opens the thread dock when
  // thread coords are wired, so a reply-less message is reachable. A plain click on the
  // message body opens it; a text selection / click on a nested control (link, image button,
  // replies affordance) is ignored (isPlainRowClick) so selecting text + viewing images +
  // following links still work. Keyboard: Enter / Space activate (role=button + tabIndex).
  const rowClickProps = onOpenThread
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: (e: React.MouseEvent): void => {
          // Pass the row element (e.currentTarget) so the nested-interactive walk can exclude
          // it — the row is itself role="button" (bug slack-thread-open-click-v1).
          if (isPlainRowClick(e.target, e.currentTarget)) {
            onOpenThread()
          }
        },
        onKeyDown: (e: React.KeyboardEvent): void => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpenThread()
          }
        }
      }
    : {}
  return (
    <div
      className={
        'flex w-full min-w-0 gap-2.5 border-b border-border/60 px-3 py-2 last:border-b-0' +
        (onOpenThread
          ? ' cursor-pointer rounded-sm hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          : '')
      }
      {...(onOpenThread ? { 'aria-label': 'Open thread' } : {})}
      {...rowClickProps}
    >
      <Avatar size="sm" className="mt-0.5">
        <AvatarFallback>{initials(name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium text-foreground">{name}</span>
          {channelName && (
            <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
              #{channelName}
            </Badge>
          )}
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">{formatTs(ts ?? '')}</span>
        </div>
        <MessageBody text={text} customEmoji={customEmoji} />
        <MessageImages images={images} onView={setViewing} />
        <RepliesAffordance replyCount={replyCount} onOpenThread={onOpenThread} />
      </div>
      <SlackImageViewer img={viewing} onOpenChange={(open) => !open && setViewing(null)} />
    </div>
  )
}
