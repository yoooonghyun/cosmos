/**
 * confluenceCatalog/components — the Confluence custom A2UI catalog components (Slack +
 * Confluence generative-UI v1, FR-005). Plain cosmos React components rendered by the
 * Confluence panel's `<A2UIProvider catalog={confluenceCatalog}>`. Cosmos palette only —
 * no Atlassian brand color, no raw hex (design §2).
 *
 * Each component receives the rest of its surface node spread in by the SDK's
 * `ComponentRenderer` plus `{ surfaceId, componentId }` (design §1.3). These are
 * DISPLAY-ONLY: they read static node props directly (the agent emits the
 * `src/shared/confluence.ts` shapes on the node) — there is NO `useFormBinding`/
 * `useDispatchAction`, no input, and no action in v1 (FR-012).
 *
 * Visuals are lifted from `ConfluencePanel.tsx` (its search rows + page detail) so the
 * agent-composed body matches the native browser body.
 *
 * Design trace: §3.1 SearchResultRow, §3.2 SearchResultList, §3.3 PageDetail,
 * §3.4 Notice, §3.5 Text.
 */

import { Info, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
import { countLabel, hasReadableBody } from './logic'

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
}

export function SearchResultRow({
  title,
  space,
  excerpt
}: SearchResultRowNode): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 border-b border-border/60 px-3 py-2 last:border-b-0">
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

export interface SearchResultListNode extends SdkProps {
  results?: SearchResultRowNode[]
}

export function SearchResultList({ results }: SearchResultListNode): React.JSX.Element {
  const items = Array.isArray(results) ? results : []
  if (items.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-sm text-muted-foreground">No content matches.</p>
    )
  }
  return (
    <div className="flex flex-col">
      <p className="px-3 py-2 text-xs text-muted-foreground" aria-live="polite">
        {countLabel(items.length, 'result', 'results')}
      </p>
      {items.map((result, i) => (
        <SearchResultRow key={result.id ?? i} {...result} surfaceId="" componentId="" />
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * PageDetail (design §3.3) — ConfluencePageDetail
 * ------------------------------------------------------------------------- */

export interface PageDetailNode extends SdkProps {
  id?: string
  title?: string
  space?: string
  body?: string
}

export function PageDetail({ title, space, body }: PageDetailNode): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4 p-3">
      <div className="flex flex-col gap-2">
        <h2 className="text-base font-medium leading-snug text-foreground">{title ?? ''}</h2>
        {space && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
              {space}
            </Badge>
          </div>
        )}
      </div>
      {hasReadableBody(body) ? (
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-card-foreground">
          {body}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">This page has no readable body.</p>
      )}
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
