/**
 * Shared Atlassian panel sub-views (Atlassian integration v1).
 *
 * Jira and Confluence are deliberate visual siblings of SlackPanel (design §0).
 * Their connection bar, connect call-to-action, error/reconnect banners, and
 * empty-line share one shape — lifted from SlackPanel and re-skinned only by a
 * `provider` label. Both Atlassian connection-status and error shapes are
 * structurally identical (see src/shared/jira.ts / confluence.ts), so these
 * helpers are typed against the minimal common shapes rather than duplicated.
 *
 * Token-only styling, cosmos palette — no Atlassian-brand color, no raw hex.
 * No token ever reaches the renderer (FR-A11, SC-009): these views only trigger
 * operations and reflect status.
 */

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

/* ------------------------------------------------------------------------- *
 * Minimal common shapes (Jira + Confluence are structurally identical here)
 * ------------------------------------------------------------------------- */

/** The four-state connection machine both Atlassian panels reflect (FR-A12). */
export interface AtlassianStatus {
  state: 'not_connected' | 'connecting' | 'connected' | 'reconnect_needed'
  siteName?: string
  accountName?: string
  lastError?: string
}

/**
 * A failed read (FR-X07); `rate_limited` carries a Retry-After cooldown.
 * `write_not_authorized` (Jira generative-UI v1) cannot arise from a read path,
 * but the union mirrors the shared `JiraErrorKind` so a `JiraError`/`AtlassianError`
 * assigns cleanly; ErrorState renders it via the generic error fallback.
 */
export interface AtlassianError {
  ok: false
  kind: 'not_connected' | 'reconnect_needed' | 'rate_limited' | 'network' | 'write_not_authorized'
  message: string
  retryAfterSeconds?: number
}

/* ------------------------------------------------------------------------- *
 * Helpers
 * ------------------------------------------------------------------------- */

/** Initials for an Avatar fallback (NO remote images — design §0/§7). */
export function initials(name: string): string {
  const parts = name.replace(/^[@#]/, '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) {
    return '?'
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase()
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Short, locale-aware time from an ISO-8601 timestamp (best effort). */
export function formatTs(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/* ------------------------------------------------------------------------- *
 * Shared sub-views (design §2.3 / §2.4)
 * ------------------------------------------------------------------------- */

/** Empty/idle line scoped to a surface. */
export function EmptyLine({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="px-3 py-6 text-center text-sm text-muted-foreground">{children}</p>
}

/**
 * Error state for a read surface (design §2.4): destructive-tinted Alert + Retry.
 * Rate-limit (429) shows the "busy, retry shortly" copy and disables Retry until
 * the Retry-After window elapses (FR-X07).
 */
export function ErrorState({
  provider,
  error,
  onRetry
}: {
  provider: string
  error: AtlassianError
  onRetry: () => void
}): React.JSX.Element {
  const [cooldown, setCooldown] = useState(
    error.kind === 'rate_limited' ? error.retryAfterSeconds ?? 0 : 0
  )
  useEffect(() => {
    if (cooldown <= 0) {
      return
    }
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(id)
  }, [cooldown])

  const isRate = error.kind === 'rate_limited'
  return (
    <div className="p-3">
      <Alert variant="destructive" className="border-destructive/40 bg-destructive/15" role="alert">
        <AlertTitle>{isRate ? `${provider} is busy` : 'Something went wrong'}</AlertTitle>
        <AlertDescription>
          {isRate ? `${provider} is busy — retrying shortly.` : error.message}
        </AlertDescription>
      </Alert>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-2"
        onClick={onRetry}
        disabled={cooldown > 0}
      >
        {cooldown > 0 ? `Retry in ${cooldown}s` : 'Retry'}
      </Button>
    </div>
  )
}

/** Reconnect-needed banner shown when a token is rejected mid-read (SC-007). */
export function ReconnectState({
  provider,
  onReconnect
}: {
  provider: string
  onReconnect: () => void
}): React.JSX.Element {
  return (
    <div className="p-3">
      <Alert variant="destructive" className="border-destructive/40 bg-destructive/15" role="alert">
        <AlertTitle>Reconnect needed</AlertTitle>
        <AlertDescription>
          Your {provider} connection expired. Reconnect to continue.
        </AlertDescription>
      </Alert>
      <Button type="button" variant="default" size="sm" className="mt-2" onClick={onReconnect}>
        Reconnect
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * Connection bar (design §2.2)
 * ------------------------------------------------------------------------- */

export function ConnectionBar({
  status,
  onDisconnect
}: {
  status: AtlassianStatus
  onDisconnect: () => void
}): React.JSX.Element {
  return (
    <div className="flex select-none items-center justify-between border-b border-border bg-popover px-3 py-2">
      {status.state === 'not_connected' && (
        <span className="text-xs text-muted-foreground">Not connected</span>
      )}
      {status.state === 'connecting' && (
        <>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Connecting…
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={onDisconnect}>
            Cancel
          </Button>
        </>
      )}
      {status.state === 'connected' && (
        <>
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {status.siteName ?? 'Connected'}
            {status.accountName && (
              <span className="text-muted-foreground"> · {status.accountName}</span>
            )}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={onDisconnect}>
            Disconnect
          </Button>
        </>
      )}
      {status.state === 'reconnect_needed' && (
        <Badge variant="outline" className="border-destructive/40 text-destructive">
          Reconnect needed
        </Badge>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * Connect call-to-action (desktop OAuth browser flow — design §6)
 * ------------------------------------------------------------------------- */

/**
 * The connect call-to-action. A single button starts cosmos's desktop OAuth flow:
 * clicking it opens the system browser for Atlassian consent; main runs PKCE
 * against cosmos's own client and persists the resulting token encrypted. No token
 * ever enters the renderer (SC-009) — the panel only triggers the flow and reflects
 * the resulting status. `lastError` covers every connect-failure message main
 * provides (cancelled / denied / state-mismatch / not-configured / no site).
 */
export function ConnectForm({
  busy,
  provider,
  reconnect,
  lastError,
  onConnect
}: {
  busy: boolean
  provider: string
  reconnect: boolean
  lastError?: string
  onConnect: () => void
}): React.JSX.Element {
  return (
    <div className="flex w-full max-w-sm flex-col gap-2 text-left">
      {reconnect && (
        <Alert
          variant="destructive"
          className="border-destructive/40 bg-destructive/15"
          role="alert"
        >
          <AlertTitle>Reconnect needed</AlertTitle>
          <AlertDescription>
            Your {provider} connection expired. Click Connect to sign in again.
          </AlertDescription>
        </Alert>
      )}
      {lastError && (
        <Alert
          variant="destructive"
          className="border-destructive/40 bg-destructive/15"
          role="alert"
        >
          <AlertTitle>Connection failed</AlertTitle>
          <AlertDescription>{lastError}</AlertDescription>
        </Alert>
      )}
      <Button type="button" variant="default" size="sm" disabled={busy} onClick={() => onConnect()}>
        {busy ? (
          <>
            <Loader2 className="size-3.5 animate-spin" /> Connecting…
          </>
        ) : (
          `Connect ${provider}`
        )}
      </Button>
      <p className="text-xs text-muted-foreground">
        Opens your browser to sign in to Atlassian. cosmos requests read-only access and stores the
        connection encrypted on this device.
      </p>
    </div>
  )
}
