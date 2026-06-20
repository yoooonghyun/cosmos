/**
 * confluenceCatalog/components — the Confluence custom A2UI catalog components (Slack +
 * Confluence generative-UI v1, FR-005). Plain cosmos React components rendered by the
 * Confluence panel's `<A2UIProvider catalog={confluenceCatalog}>`. Cosmos palette only —
 * no Atlassian brand color, no raw hex (design §2).
 *
 * Each component receives the rest of its surface node spread in by the SDK's
 * `ComponentRenderer` plus `{ surfaceId, componentId }` (design §1.3).
 *
 * confluence-generative-adapter-v1 (design §6): `SearchResultList` (backs BOTH the
 * default feed and search results) + `PageDetail` are now BOUND — they read their
 * rows/value + `loading`/`hasMore`/`error` flags from the data model via `useBound`/
 * `useDataBinding` (FR-001/FR-004), render the SHARED `RefreshButton` (+ `LoadMoreButton`
 * for the lists), and degrade a recoverable fetch error to a destructive Notice above
 * kept rows/content. `SearchResultRow`/`Notice`/`Text` remain display-only, unchanged.
 * APPEND-ONLY (FR-011): no PaginationBar, no `hasPrev`. READ-ONLY: the only actions any
 * surface emits are the reserved `adapter.refresh`/`adapter.loadMore`.
 *
 * Visuals are lifted from `ConfluencePanel.tsx` (its search rows + page detail) so the
 * agent-composed body matches the native browser body.
 *
 * Design trace: §2.1/§2.2 SearchResultList (feed + search), §2.3 PageDetail,
 * §3 states, §6 catalog re-point.
 */

import { useDataBinding, useDispatchAction } from '@a2ui-sdk/react/0.9'
import { ExternalLink, Info, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
// confluence-generative-adapter-v1 (design §6): the bound Confluence list + detail reuse
// the SHARED adapter controls + binding helpers VERBATIM (the single definition the Jira
// and Slack catalogs also use). Confluence registers LoadMoreButton only — never
// PaginationBar (append-only). Refresh moved to the panel chrome (panel-refresh-v1, FR-006).
import { LoadMoreButton, useBound, type Bound } from '../catalogShared/controls'
import {
  boundRows,
  CONFLUENCE_OPEN_DETAIL_ACTION,
  countLabel,
  isOpenDetailEmittable,
  showEmptyState,
  showErrorNotice
} from './logic'
import { sanitizeConfluenceHtml } from './sanitize'

/**
 * The SHARED Confluence page-detail BODY (confluence-detail-rich-render-v1, FR-007/FR-008,
 * design §2/§5). Rendered by BOTH the gen-UI catalog `PageDetail` (below) and the native
 * `ConfluencePanel.PageDetail`, so the two surfaces are byte-for-byte identical (SC-002):
 * one component, one class string, one sanitize call.
 *
 * `body` is RAW Confluence `body-format=view` HTML. This is the ONE sanctioned
 * `dangerouslySetInnerHTML` site — `sanitizeConfluenceHtml` (DOMPurify) MUST run first
 * (FR-008). An empty body (after sanitize) shows the safe "no readable body" state
 * (FR-012); never an empty `prose` container. The scoped `prose prose-sm prose-cosmos`
 * container themes the rich content to cosmos tokens (design §3/§7) without leaking into
 * the surrounding panel chrome.
 */
export const PAGE_DETAIL_BODY_CLASS = 'prose prose-sm prose-cosmos max-w-none break-words'

export function PageDetailBody({ body }: { body: string | undefined }): React.JSX.Element {
  const safeHtml = sanitizeConfluenceHtml(body)
  if (safeHtml.trim() === '') {
    return <p className="text-sm text-muted-foreground">This page has no readable body.</p>
  }
  return (
    <div className={PAGE_DETAIL_BODY_CLASS} dangerouslySetInnerHTML={{ __html: safeHtml }} />
  )
}

/**
 * Is `webUrl` a usable, absolute `http(s)` URL? Belt-and-suspenders guard at the render
 * site (confluence-detail-weblink-v1 #87, FR-010) — the main-side `confluenceWebUrl`
 * assembler already enforces this, but the bound/native value re-validates here so a
 * non-`http(s)` value can never become a live link. Pure; never throws.
 */
function isOpenableWebUrl(webUrl: string | undefined): webUrl is string {
  if (typeof webUrl !== 'string' || webUrl.trim() === '') {
    return false
  }
  try {
    const u = new URL(webUrl)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * The SHARED Confluence page-detail TITLE (confluence-detail-weblink-v1 #87, design §1).
 * Rendered by BOTH the gen-UI catalog `PageDetail` (below) and the native
 * `ConfluencePanel.PageDetail`, so the title treatment cannot drift (SC-005): one
 * component, one class string.
 *
 * When a usable absolute `http(s)` `webUrl` is present the title text becomes an inline
 * external link (with a trailing `ExternalLink` glyph) that opens the page in the system
 * browser via the existing `setWindowOpenHandler` → `shell.openExternal` hand-off (#85's
 * integration-agnostic handler; no new IPC/scope/fetch). The link inherits the heading's
 * `text-foreground` (NOT `--primary`). When `webUrl` is absent it degrades to plain title
 * text — no anchor, no icon, no extra tab stop (FR-004). The caller owns the `h2` wrapper
 * (typography + heading semantics stay on the `h2`).
 */
export function PageDetailTitle({
  title,
  webUrl
}: {
  title: string
  webUrl?: string
}): React.JSX.Element {
  if (!isOpenableWebUrl(webUrl)) {
    return <>{title}</>
  }
  return (
    <a
      href={webUrl}
      target="_blank"
      rel="noreferrer"
      title={`${title} — open in Confluence`}
      className="group inline-flex max-w-full items-center gap-1.5 rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card"
    >
      <span className="min-w-0">{title}</span>
      <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </a>
  )
}

/** Props the SDK injects into every catalog component. */
interface SdkProps {
  surfaceId: string
  componentId: string
}

/* ------------------------------------------------------------------------- *
 * SearchResultRow / SearchResultList (design §3.1 / §3.2) — ConfluenceSearchResult
 * ------------------------------------------------------------------------- */

export interface SearchResultRowNode extends SdkProps {
  id?: string
  title?: string
  space?: string
  excerpt?: string
  /**
   * confluence-page-detail-nav-v1 (design §1.3/§2.1): toggles the clickable affordance
   * (cursor + hover lift) on the row's `div`. Set by `SearchResultList` only for a row with
   * a non-empty page id; the inert no-id row keeps the default cursor and no hover.
   */
  actionable?: boolean
}

export function SearchResultRow({
  title,
  space,
  excerpt,
  actionable
}: SearchResultRowNode): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 border-b border-border/60 px-3 py-2 transition-colors last:border-b-0',
        actionable && 'cursor-pointer hover:bg-accent/40'
      )}
    >
      <div className="flex w-full items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {title ?? ''}
        </span>
        {space && (
          <Badge variant="outline" className="ml-auto shrink-0 px-1.5 py-0 text-[10px]">
            {space}
          </Badge>
        )}
      </div>
      {excerpt && (
        <span className="line-clamp-2 w-full whitespace-normal text-xs text-muted-foreground">
          {excerpt}
        </span>
      )}
    </div>
  )
}

/**
 * The recoverable-error Notice the bound list + detail render ABOVE kept rows/content
 * (design §3 / FR-007). Reuses the catalog's destructive Alert treatment; prior data is
 * NOT cleared. Returns null when there is no error message.
 */
function BoundListError({ message }: { message: string | undefined }): React.JSX.Element | null {
  if (!showErrorNotice(message)) {
    return null
  }
  return (
    <Alert variant="destructive" className="border-destructive/40 bg-destructive/15">
      <TriangleAlert className="text-destructive" />
      <AlertDescription className="text-destructive">{message}</AlertDescription>
    </Alert>
  )
}

export interface SearchResultListNode extends SdkProps {
  /**
   * The rows. A bound surface passes a `{path}` (confluence-generative-adapter-v1,
   * FR-001/FR-002) so a refresh / load-more `updateDataModel` re-renders the list in
   * place; a static builder passes the literal array. Resolved through `useBound`. ONE
   * `SearchResultList` backs BOTH the default feed and search results (design §2.2).
   */
  results?: Bound<SearchResultRowNode[]>
  /** Bound busy flag (FR-004) — drives the RefreshButton + LoadMoreButton spinners. */
  loading?: Bound<boolean>
  /** Bound "a next page exists" flag (FR-012) — gates the LoadMoreButton. */
  hasMore?: Bound<boolean>
  /** Bound recoverable error notice (FR-007) — shown above the list when present. */
  error?: Bound<string>
  /** Region key (multi-region partitioned surface) — forwarded to LoadMoreButton so a
   * load-more reloads only this container's fetcher. Absent → surface-wide. */
  region?: string
}

export function SearchResultList({
  surfaceId,
  componentId,
  results,
  loading,
  hasMore,
  error,
  region
}: SearchResultListNode): React.JSX.Element {
  const rows = useBound<SearchResultRowNode[]>(surfaceId, results, undefined)
  const isLoading = useDataBinding<boolean>(surfaceId, loading, false)
  const errorMessage = useDataBinding<string | undefined>(surfaceId, error, undefined)
  const dispatch = useDispatchAction()
  const items = boundRows(rows)
  // confluence-page-detail-nav-v1: a row with a non-empty page id opens that page's detail
  // in place by REUSING the native page-detail browser (not a separate A2UI surface). The
  // action is handled renderer-locally by the panel's `onAction` seam (never sent to
  // main/agent — CONFLUENCE_OPEN_DETAIL_ACTION is a non-confluence.* nav action). It carries
  // the `pageId` (the native `PageDetail` re-reads the body via `getPage`) + the `title` (so
  // the native back row shows it immediately). A row with no id is inert (no button).
  const open = (pageId: string | undefined, title: string | undefined): void => {
    if (!isOpenDetailEmittable(pageId)) {
      return
    }
    dispatch(surfaceId, componentId, {
      name: CONFLUENCE_OPEN_DETAIL_ACTION,
      context: { pageId: pageId as string, title: title ?? '' }
    })
  }
  if (showEmptyState(items.length, errorMessage)) {
    return (
      <p
        className="px-3 py-6 text-center text-sm text-muted-foreground"
        aria-busy={isLoading}
      >
        No content matches.
      </p>
    )
  }
  return (
    <div className="flex flex-col" aria-busy={isLoading}>
      <BoundListError message={errorMessage} />
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {countLabel(items.length, 'result', 'results')}
        </p>
      </div>
      {items.map((result, i) => {
        const actionable = isOpenDetailEmittable(result.id)
        // Actionable (non-empty id): a real <button> wrapper — focusable, Enter/Space for
        // free, cosmos focus ring drawn INSET (the Confluence list is a flush divided list,
        // not rounded cards — design §1.3). Do NOT add rounded-*.
        return actionable ? (
          <button
            key={result.id}
            type="button"
            className="w-full text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            aria-label={`Open ${result.title ?? 'page'}`}
            onClick={() => open(result.id, result.title)}
          >
            <SearchResultRow {...result} actionable surfaceId="" componentId="" />
          </button>
        ) : (
          // Non-actionable (no/empty id): the inert row, no wrapper, skipped in tab order.
          <SearchResultRow key={i} {...result} surfaceId="" componentId="" />
        )
      })}
      <LoadMoreButton
        surfaceId={surfaceId}
        componentId={componentId}
        loading={loading}
        hasMore={hasMore}
        region={region}
      />
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * PageDetail (design §3.3) — ConfluencePageDetail
 * ------------------------------------------------------------------------- */

export interface PageDetailNode extends SdkProps {
  id?: string
  /**
   * Display props. A bound surface passes a `{path}` (confluence-generative-adapter-v1,
   * FR-001/FR-002) so a refresh `updateDataModel` re-renders the detail in place; a
   * static builder passes the literal string. Resolved through `useBound`.
   */
  title?: Bound<string>
  space?: Bound<string>
  body?: Bound<string>
  /**
   * Bound canonical web URL (confluence-detail-weblink-v1 #87). When present + absolute
   * `http(s)`, the title renders as an "Open in Confluence" external link; absent → plain
   * title (degrade-to-omit, FR-004). Non-secret — assembled from the page read's `_links`.
   */
  webUrl?: Bound<string>
  /** Bound busy flag (FR-004) — drives the RefreshButton spinner + aria-busy. */
  loading?: Bound<boolean>
  /** Bound recoverable error notice (FR-007) — shown above the stale detail when present. */
  error?: Bound<string>
}

export function PageDetail({
  surfaceId,
  title,
  space,
  body,
  webUrl,
  loading,
  error
}: PageDetailNode): React.JSX.Element {
  const titleText = useBound<string>(surfaceId, title, '')
  const spaceText = useBound<string>(surfaceId, space, '')
  const bodyText = useBound<string>(surfaceId, body, '')
  const webUrlText = useBound<string>(surfaceId, webUrl, '')
  const isLoading = useDataBinding<boolean>(surfaceId, loading, false)
  const errorMessage = useDataBinding<string | undefined>(surfaceId, error, undefined)
  return (
    <div className="flex flex-col gap-4 p-3" aria-busy={isLoading}>
      <BoundListError message={errorMessage} />
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-medium leading-snug text-foreground">
            <PageDetailTitle title={titleText ?? ''} webUrl={webUrlText || undefined} />
          </h2>
        </div>
        {spaceText && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
              {spaceText}
            </Badge>
          </div>
        )}
      </div>
      <PageDetailBody body={bodyText} />
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * Notice (design §3.4) — not-connected / read-error / empty fallback (FR-011)
 * ------------------------------------------------------------------------- */

export interface NoticeNode extends SdkProps {
  noticeKind?: 'info' | 'error'
  message?: string
}

export function Notice({ noticeKind, message }: NoticeNode): React.JSX.Element {
  const isError = noticeKind === 'error'
  const Glyph = isError ? TriangleAlert : Info
  return (
    <Alert
      variant={isError ? 'destructive' : 'default'}
      className={isError ? 'border-destructive/40 bg-destructive/15' : ''}
    >
      <Glyph className={isError ? 'text-destructive' : 'text-muted-foreground'} />
      <AlertDescription className={isError ? 'text-destructive' : 'text-card-foreground'}>
        {message ?? ''}
      </AlertDescription>
    </Alert>
  )
}

/* ------------------------------------------------------------------------- *
 * Text passthrough (design §3.5) — identical to the Jira/Slack catalog's Text
 * ------------------------------------------------------------------------- */

export interface TextNode extends SdkProps {
  text?: string
  variant?: 'label' | 'body'
  muted?: boolean
}

export function Text({ text, variant, muted }: TextNode): React.JSX.Element {
  if (variant === 'label') {
    return <span className="text-xs font-medium text-muted-foreground">{text ?? ''}</span>
  }
  return (
    <p
      className={cn(
        'whitespace-pre-wrap break-words text-sm leading-relaxed',
        muted ? 'text-muted-foreground' : 'text-card-foreground'
      )}
    >
      {text ?? ''}
    </p>
  )
}
