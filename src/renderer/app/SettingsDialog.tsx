import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarDays, Check, Link2, Loader2, RotateCcw, Settings } from 'lucide-react'
import { SiConfluence, SiGooglecalendar, SiJira, SiSlack } from 'react-icons/si'
import type {
  ClientConfigField,
  ClientConfigSavePayload,
  ClientConfigSaveResult,
  ClientConfigStatus,
  EnabledIntegrations,
  GateableIntegration
} from '../../shared/ipc'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { shouldShowStatusDot, type ConnectionState } from './settingsStatusDot'
import { useConfirm } from '../confirm/useConfirm'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { confirmCopy } from '../confirm/confirmLogic'

/** A live per-integration connection status (non-secret identity only). */
interface LiveStatus {
  state: ConnectionState
  siteName?: string
  accountName?: string
}

/**
 * The `window.cosmos.<int>` surfaces a tab drives for connect/disconnect/status. Each
 * integration manager exposes the same getStatus/onStatusChanged/connect/disconnect
 * contract; the dialog reuses them (no parallel connect path — design §4.3/§5).
 */
interface IntegrationApi {
  getStatus(): Promise<{ state: string; siteName?: string; accountName?: string }>
  onStatusChanged(listener: (s: { state: string; siteName?: string; accountName?: string }) => void): () => void
  connect(): Promise<unknown>
  disconnect(): Promise<unknown>
}

/**
 * settings-oauth-clients-v1 (design §B) — the Settings dialog. Opened from the rail
 * gear; configures the Slack client id + the Atlassian client id/secret. Reads the
 * renderer-safe `ClientConfigStatus` on open (never the secret value), and writes via
 * the `settings:` IPC surface. The secret is WRITE-ONLY: never rendered, never seeded,
 * no reveal — only "set/replace" entry and "clear".
 *
 * `connected` is the LIVE connection status of the three integrations (derived in
 * App.tsx from each panel's `*:statusChanged`). It drives the precise force-disconnect
 * affordances: the passive inline caption (a dirty field whose integration is
 * connected) and the confirm-on-Save (the pending change WILL sign out ≥1 connected
 * integration). No connected integration affected ⇒ Save proceeds with no confirm.
 */
export interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connected: { slack: boolean; jira: boolean; confluence: boolean; google: boolean }
  /** Per-integration rail-visibility preference (settings-redesign-v1, FR-003/FR-004). */
  enabled: EnabledIntegrations
  /** Toggle one integration's rail visibility (writes through the session snapshot). */
  onEnabledChange: (id: GateableIntegration, on: boolean) => void
}

/** A dirty id field tracks its pending edited value (null = untouched). */
type IdDraft = string | null

export function SettingsDialog({
  open,
  onOpenChange,
  connected,
  enabled,
  onEnabledChange
}: SettingsDialogProps): React.JSX.Element {
  const [status, setStatus] = useState<ClientConfigStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<ClientConfigSaveResult | null>(null)
  const [confirming, setConfirming] = useState(false)

  // disconnect-confirm-modal-v1: gate each per-integration Disconnect row behind the
  // shared confirm modal. This is its OWN flow, independent of the Save-confirm
  // (`confirming` above), which stays as-is (a multi-integration force-disconnect-on-Save
  // warning). The two confirm surfaces never act on the same action simultaneously.
  const confirmDisconnect = useConfirm()

  // Live per-integration connection status, for the status dot + connect/disconnect
  // block in each tab. Subscribes only while the dialog is open (design §4.3).
  const liveStatus = useLiveStatuses(open)

  // Pending edits. An id draft of null = untouched; '' = revert-to-env (FR-015).
  const [slackIdDraft, setSlackIdDraft] = useState<IdDraft>(null)
  const [atlassianIdDraft, setAtlassianIdDraft] = useState<IdDraft>(null)
  const [googleIdDraft, setGoogleIdDraft] = useState<IdDraft>(null)
  // The secret is entry-only: when the entry row is open, the draft holds the typed
  // value; a non-null draft (even '') means the entry is open. We send the secret only
  // when the draft is a non-empty string. Google is also a confidential client, so it
  // has its own write-only secret draft alongside Atlassian's.
  const [secretDraft, setSecretDraft] = useState<string | null>(null)
  const [googleSecretDraft, setGoogleSecretDraft] = useState<string | null>(null)

  const resetDrafts = useCallback(() => {
    setSlackIdDraft(null)
    setAtlassianIdDraft(null)
    setGoogleIdDraft(null)
    setSecretDraft(null)
    setGoogleSecretDraft(null)
    setResult(null)
    setConfirming(false)
  }, [])

  // Load the renderer-safe status each time the dialog opens (a fresh local IPC read).
  useEffect(() => {
    if (!open) {
      return
    }
    let cancelled = false
    resetDrafts()
    setLoading(true)
    void window.cosmos.settings
      .getConfig()
      .then((s) => {
        if (!cancelled) {
          setStatus(s)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, resetDrafts])

  // The effective value shown in each id input: the pending draft if edited, else the
  // status's effective value.
  const slackIdValue = slackIdDraft ?? status?.slack.clientId ?? ''
  const atlassianIdValue = atlassianIdDraft ?? status?.atlassian.clientId ?? ''
  const googleIdValue = googleIdDraft ?? status?.google.clientId ?? ''

  // What WILL change if the user saves now (effective-level, mirrors main's diff).
  const slackChanged = slackIdDraft !== null && slackIdDraft !== (status?.slack.clientId ?? '')
  const atlassianIdChanged =
    atlassianIdDraft !== null && atlassianIdDraft !== (status?.atlassian.clientId ?? '')
  const secretChanged = secretDraft !== null && secretDraft.length > 0
  const atlassianChanged = atlassianIdChanged || secretChanged
  const googleIdChanged =
    googleIdDraft !== null && googleIdDraft !== (status?.google.clientId ?? '')
  const googleSecretChanged = googleSecretDraft !== null && googleSecretDraft.length > 0
  const googleChanged = googleIdChanged || googleSecretChanged

  const hasPendingChange = slackChanged || atlassianChanged || googleChanged

  // Which connected integrations a Save would force-disconnect (design §F).
  const wouldDisconnect = useMemo(
    () => ({
      slack: slackChanged && connected.slack,
      jira: atlassianChanged && connected.jira,
      confluence: atlassianChanged && connected.confluence,
      google: googleChanged && connected.google
    }),
    [slackChanged, atlassianChanged, googleChanged, connected]
  )
  const willSignOutAny =
    wouldDisconnect.slack ||
    wouldDisconnect.jira ||
    wouldDisconnect.confluence ||
    wouldDisconnect.google

  const buildSavePayload = useCallback((): ClientConfigSavePayload => {
    const payload: ClientConfigSavePayload = {}
    if (slackIdDraft !== null) {
      payload.slack = { clientId: slackIdDraft }
    }
    const atlassian: { clientId?: string; clientSecret?: string } = {}
    if (atlassianIdDraft !== null) {
      atlassian.clientId = atlassianIdDraft
    }
    if (secretDraft !== null && secretDraft.length > 0) {
      atlassian.clientSecret = secretDraft
    }
    if (Object.keys(atlassian).length > 0) {
      payload.atlassian = atlassian
    }
    const google: { clientId?: string; clientSecret?: string } = {}
    if (googleIdDraft !== null) {
      google.clientId = googleIdDraft
    }
    if (googleSecretDraft !== null && googleSecretDraft.length > 0) {
      google.clientSecret = googleSecretDraft
    }
    if (Object.keys(google).length > 0) {
      payload.google = google
    }
    return payload
  }, [slackIdDraft, atlassianIdDraft, secretDraft, googleIdDraft, googleSecretDraft])

  const applyResult = useCallback((r: ClientConfigSaveResult) => {
    setResult(r)
    if (r.ok) {
      setStatus(r.status)
      // Clear drafts: the new status now reflects the saved values.
      setSlackIdDraft(null)
      setAtlassianIdDraft(null)
      setGoogleIdDraft(null)
      setSecretDraft(null)
      setGoogleSecretDraft(null)
    }
  }, [])

  const performSave = useCallback(async () => {
    setSaving(true)
    setConfirming(false)
    try {
      const r = await window.cosmos.settings.save(buildSavePayload())
      applyResult(r)
    } finally {
      setSaving(false)
    }
  }, [buildSavePayload, applyResult])

  const onSaveClick = useCallback(() => {
    if (!hasPendingChange) {
      return
    }
    // Confirm-on-Save only when the pending change signs out a connected integration.
    if (willSignOutAny && !confirming) {
      setConfirming(true)
      return
    }
    void performSave()
  }, [hasPendingChange, willSignOutAny, confirming, performSave])

  const clearField = useCallback(
    async (field: ClientConfigField) => {
      setSaving(true)
      setConfirming(false)
      try {
        const r = await window.cosmos.settings.clearField({ field })
        applyResult(r)
      } finally {
        setSaving(false)
      }
    },
    [applyResult]
  )

  // Esc/overlay close is blocked while a save is in flight (don't lose the write).
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (saving) {
        return
      }
      if (!next && confirming) {
        // Esc while confirming cancels the confirm, not the dialog.
        setConfirming(false)
        return
      }
      onOpenChange(next)
    },
    [saving, confirming, onOpenChange]
  )

  // The disconnect-confirm copy is driven by the open target's label (or empty when
  // closed). Rendered as a sibling of the Settings Dialog so it portals ABOVE it.
  const confirmLabel = confirmDisconnect.state.target?.label ?? ''
  const disconnectCopy = confirmCopy(confirmLabel)

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex h-[600px] max-w-[860px] flex-col gap-0 overflow-hidden bg-popover p-0 sm:max-w-[860px]">
        <DialogHeader className="border-b border-border px-6 pt-6 pb-4">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Turn integrations on to add their panel to the sidebar, then connect each from its
            own tab.
          </DialogDescription>
        </DialogHeader>

        {/* Two-pane tabbed body: a vertical side-nav (left) + the active tab's content
            (right). One tab visible at a time (FR-001/SC-001). The tab-rail labels are
            static so it renders immediately; only the tab CONTENT waits on getConfig. */}
        <Tabs
          orientation="vertical"
          defaultValue="general"
          className="!gap-0 items-stretch min-h-0 flex-1 overflow-hidden"
        >
          <TabsList
            variant="line"
            aria-label="Settings sections"
            className="w-44 shrink-0 flex-col items-stretch gap-0.5 rounded-none border-r border-border bg-popover/40 p-2"
          >
            <SettingsTab value="general" icon={<Settings className="size-4" />} label="General" />
            <SettingsTab
              value="slack"
              icon={<SiSlack className="size-4" />}
              label="Slack"
              dot={
                shouldShowStatusDot(liveStatus.slack.state) ? (
                  <StatusDot state={liveStatus.slack.state} />
                ) : null
              }
              dimmed={!enabled.slack}
            />
            <SettingsTab
              value="jira"
              icon={<SiJira className="size-4" />}
              label="Jira"
              dot={
                shouldShowStatusDot(liveStatus.jira.state) ? (
                  <StatusDot state={liveStatus.jira.state} />
                ) : null
              }
              dimmed={!enabled.jira}
            />
            <SettingsTab
              value="confluence"
              icon={<SiConfluence className="size-4" />}
              label="Confluence"
              dot={
                shouldShowStatusDot(liveStatus.confluence.state) ? (
                  <StatusDot state={liveStatus.confluence.state} />
                ) : null
              }
              dimmed={!enabled.confluence}
            />
            <SettingsTab
              value="google-calendar"
              icon={<SiGooglecalendar className="size-4" />}
              label="Google Cal"
              dot={
                shouldShowStatusDot(liveStatus['google-calendar'].state) ? (
                  <StatusDot state={liveStatus['google-calendar'].state} />
                ) : null
              }
              dimmed={!enabled['google-calendar']}
            />
          </TabsList>

          <div className="flex-1 overflow-hidden">
            <TabsContent
              value="general"
              className="h-full overflow-y-auto px-6 py-5 outline-none"
            >
              <GeneralTab enabled={enabled} liveStatus={liveStatus} />
            </TabsContent>

            <TabsContent
              value="slack"
              className="h-full overflow-y-auto px-6 py-5 outline-none"
              aria-busy={loading}
            >
              <IntegrationTab
                icon={<SiSlack className="size-4" />}
                title="Slack"
                caption="Read channels and threads, post replies."
                integration="slack"
                enabled={enabled.slack}
                onEnabledChange={(on) => onEnabledChange('slack', on)}
                live={liveStatus.slack}
                onConnect={() => void window.cosmos.slack.connect()}
                onDisconnect={() =>
                  confirmDisconnect.requestConfirm(
                    { integration: 'slack', label: 'Slack' },
                    () => void window.cosmos.slack.disconnect()
                  )
                }
                onCancel={() => void window.cosmos.slack.cancelConnect()}
              >
                {loading || !status ? (
                  <LoadingBody />
                ) : (
                  <IdField
                    id="slack-client-id"
                    label="Client ID"
                    placeholder="Paste your Slack client ID"
                    value={slackIdValue}
                    source={status.slack.source}
                    disabled={saving}
                    onChange={setSlackIdDraft}
                    onReset={() => void clearField('slack.clientId')}
                    resetLabel="Reset Slack Client ID to .env default"
                    consequence={
                      slackChanged && connected.slack
                        ? 'Saving will sign out Slack — you’ll need to reconnect.'
                        : null
                    }
                  />
                )}
              </IntegrationTab>
            </TabsContent>

            <TabsContent
              value="jira"
              className="h-full overflow-y-auto px-6 py-5 outline-none"
              aria-busy={loading}
            >
              <IntegrationTab
                icon={<SiJira className="size-4" />}
                title="Jira"
                caption="Search issues, view detail, run transitions."
                integration="jira"
                enabled={enabled.jira}
                onEnabledChange={(on) => onEnabledChange('jira', on)}
                live={liveStatus.jira}
                onConnect={() => void window.cosmos.jira.connect()}
                onDisconnect={() =>
                  confirmDisconnect.requestConfirm(
                    { integration: 'jira', label: 'Jira' },
                    () => void window.cosmos.jira.disconnect()
                  )
                }
                onCancel={() => void window.cosmos.jira.cancelConnect()}
              >
                <SharedAtlassianBanner thisProduct="Jira" otherProduct="Confluence" />
                {loading || !status ? (
                  <LoadingBody />
                ) : (
                  <AtlassianCredentials
                    status={status}
                    saving={saving}
                    atlassianIdValue={atlassianIdValue}
                    atlassianIdChanged={atlassianIdChanged}
                    secretDraft={secretDraft}
                    secretChanged={secretChanged}
                    connected={connected}
                    onIdChange={setAtlassianIdDraft}
                    onSecretDraftChange={setSecretDraft}
                    clearField={clearField}
                  />
                )}
              </IntegrationTab>
            </TabsContent>

            <TabsContent
              value="confluence"
              className="h-full overflow-y-auto px-6 py-5 outline-none"
              aria-busy={loading}
            >
              <IntegrationTab
                icon={<SiConfluence className="size-4" />}
                title="Confluence"
                caption="Browse spaces and read pages."
                integration="confluence"
                enabled={enabled.confluence}
                onEnabledChange={(on) => onEnabledChange('confluence', on)}
                live={liveStatus.confluence}
                onConnect={() => void window.cosmos.confluence.connect()}
                onDisconnect={() =>
                  confirmDisconnect.requestConfirm(
                    { integration: 'confluence', label: 'Confluence' },
                    () => void window.cosmos.confluence.disconnect()
                  )
                }
                onCancel={() => void window.cosmos.confluence.cancelConnect()}
              >
                <SharedAtlassianBanner thisProduct="Confluence" otherProduct="Jira" />
                {loading || !status ? (
                  <LoadingBody />
                ) : (
                  <AtlassianCredentials
                    status={status}
                    saving={saving}
                    atlassianIdValue={atlassianIdValue}
                    atlassianIdChanged={atlassianIdChanged}
                    secretDraft={secretDraft}
                    secretChanged={secretChanged}
                    connected={connected}
                    onIdChange={setAtlassianIdDraft}
                    onSecretDraftChange={setSecretDraft}
                    clearField={clearField}
                  />
                )}
              </IntegrationTab>
            </TabsContent>

            <TabsContent
              value="google-calendar"
              className="h-full overflow-y-auto px-6 py-5 outline-none"
              aria-busy={loading}
            >
              <IntegrationTab
                icon={<CalendarDays className="size-4" />}
                title="Google Cal"
                caption="See your upcoming schedule."
                integration="google-calendar"
                enabled={enabled['google-calendar']}
                onEnabledChange={(on) => onEnabledChange('google-calendar', on)}
                live={liveStatus['google-calendar']}
                onConnect={() => void window.cosmos.googleCalendar.connect()}
                onDisconnect={() =>
                  confirmDisconnect.requestConfirm(
                    { integration: 'google-calendar', label: 'Google Calendar' },
                    () => void window.cosmos.googleCalendar.disconnect()
                  )
                }
                onCancel={() => void window.cosmos.googleCalendar.cancelConnect()}
              >
                {loading || !status ? (
                  <LoadingBody />
                ) : (
                  <>
                    <IdField
                      id="google-client-id"
                      label="Client ID"
                      placeholder="Paste your Google client ID"
                      value={googleIdValue}
                      source={status.google.clientIdSource}
                      disabled={saving}
                      onChange={setGoogleIdDraft}
                      onReset={() => void clearField('google.clientId')}
                      resetLabel="Reset Google Client ID to .env default"
                      consequence={
                        googleIdChanged && connected.google
                          ? 'Saving will sign out Google Cal — you’ll need to reconnect.'
                          : null
                      }
                    />
                    <SecretField
                      id="google-client-secret"
                      clearAriaLabel="Clear Google client secret"
                      configured={status.google.secretConfigured}
                      source={status.google.secretSource}
                      disabled={saving}
                      draft={googleSecretDraft}
                      onDraftChange={setGoogleSecretDraft}
                      onClear={() => void clearField('google.clientSecret')}
                      consequence={
                        googleSecretChanged && connected.google
                          ? 'Saving will sign out Google Cal — you’ll need to reconnect.'
                          : null
                      }
                    />
                  </>
                )}
              </IntegrationTab>
            </TabsContent>
          </div>
        </Tabs>

        {/* Save-feedback slot (shared across tabs) */}
        <FeedbackSlot result={result} saving={saving} />

        <DialogFooter className="border-t border-border px-6 py-3">
          {confirming ? (
            <div className="flex w-full flex-col gap-2">
              <Alert>
                <AlertTriangle className="size-4" />
                <AlertTitle>{confirmTitle(wouldDisconnect)}</AlertTitle>
                <AlertDescription>This will sign you out — you’ll need to reconnect.</AlertDescription>
              </Alert>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setConfirming(false)} disabled={saving}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={() => void performSave()} disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    'Save & sign out'
                  )}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <DialogClose asChild>
                <Button variant="ghost" disabled={saving}>
                  Close
                </Button>
              </DialogClose>
              <Button onClick={onSaveClick} disabled={!hasPendingChange || saving || loading}>
                {saving ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Saving…
                  </>
                ) : (
                  'Save'
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>

      <ConfirmDialog
        open={confirmDisconnect.state.open}
        title={disconnectCopy.title}
        description={disconnectCopy.body}
        onConfirm={confirmDisconnect.confirm}
        onOpenChange={(next) => {
          if (!next) {
            confirmDisconnect.cancel()
          }
        }}
      />
    </>
  )
}

function confirmTitle(d: {
  slack: boolean
  jira: boolean
  confluence: boolean
  google: boolean
}): string {
  const names: string[] = []
  if (d.slack) names.push('Slack')
  if (d.jira) names.push('Jira')
  if (d.confluence) names.push('Confluence')
  if (d.google) names.push('Google Cal')
  if (names.length === 0) {
    return 'Save changes?'
  }
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `This will sign out ${list}. Save?`
}

function LoadingBody(): React.JSX.Element {
  return (
    <div className="space-y-6">
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  )
}

function GroupHeader({
  icon,
  title,
  caption
}: {
  icon: React.ReactNode
  title: string
  caption: string
}): React.JSX.Element {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        {icon}
        <span>{title}</span>
      </div>
      <p className="text-xs text-muted-foreground">{caption}</p>
    </div>
  )
}

function SourceBadge({
  source
}: {
  source: ClientConfigStatus['slack']['source']
}): React.JSX.Element {
  if (source === 'settings') {
    return <Badge variant="secondary">Settings</Badge>
  }
  if (source === 'env') {
    return <Badge variant="outline">from .env</Badge>
  }
  return <span className="text-xs text-muted-foreground">Unset</span>
}

function IdField({
  id,
  label,
  placeholder,
  value,
  source,
  disabled,
  onChange,
  onReset,
  resetLabel,
  consequence
}: {
  id: string
  label: string
  placeholder: string
  value: string
  source: ClientConfigStatus['slack']['source']
  disabled: boolean
  onChange: (next: string) => void
  onReset: () => void
  resetLabel: string
  consequence: string | null
}): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        <div className="flex items-center gap-2">
          <SourceBadge source={source} />
          {source === 'settings' && (
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground hover:text-foreground"
              onClick={onReset}
              disabled={disabled}
              aria-label={resetLabel}
            >
              <RotateCcw />
              Reset
            </Button>
          )}
        </div>
      </div>
      <Input
        id={id}
        type="text"
        className="h-9"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {consequence && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="size-3.5" />
          {consequence}
        </p>
      )}
    </div>
  )
}

function SecretField({
  id,
  clearAriaLabel,
  configured,
  source,
  disabled,
  draft,
  onDraftChange,
  onClear,
  consequence
}: {
  /** The input element id (also the label `htmlFor`). Per-integration so two secret
      fields can co-exist in one dialog without colliding ids. */
  id: string
  /** Accessible label on the Clear control (per-integration). */
  clearAriaLabel: string
  configured: boolean
  source: ClientConfigStatus['atlassian']['secretSource']
  disabled: boolean
  draft: string | null
  onDraftChange: (next: string | null) => void
  onClear: () => void
  consequence: string | null
}): React.JSX.Element {
  const entryOpen = draft !== null
  const helpId = `${id}-help`
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>Client Secret</Label>
        <div className="flex items-center gap-2" aria-live="polite">
          {configured ? (
            <>
              <span className="flex items-center gap-1 text-xs text-foreground">
                <Check className="size-3.5 text-primary" />
                Secret configured
              </span>
              {source === 'settings' ? (
                <Badge variant="secondary">Settings</Badge>
              ) : (
                <Badge variant="outline">from .env</Badge>
              )}
            </>
          ) : (
            <span className="text-xs text-muted-foreground">Not configured</span>
          )}
        </div>
      </div>

      {entryOpen ? (
        <div className="space-y-1.5">
          <Input
            id={id}
            type="password"
            className="h-9"
            placeholder="Enter new client secret"
            value={draft ?? ''}
            disabled={disabled}
            autoComplete="off"
            aria-describedby={helpId}
            onChange={(e) => onDraftChange(e.target.value)}
          />
          <div className="flex items-center justify-between">
            <p id={helpId} className="text-xs text-muted-foreground">
              The secret is stored encrypted and never displayed again.
            </p>
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => onDraftChange(null)}
              disabled={disabled}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => onDraftChange('')}
            disabled={disabled}
          >
            {configured ? 'Replace' : 'Set secret'}
          </Button>
          {configured && source === 'settings' && (
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground hover:text-foreground"
              onClick={onClear}
              disabled={disabled}
              aria-label={clearAriaLabel}
            >
              <RotateCcw />
              Clear
            </Button>
          )}
        </div>
      )}

      {consequence && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="size-3.5" />
          {consequence}
        </p>
      )}
    </div>
  )
}

function FeedbackSlot({
  result,
  saving
}: {
  result: ClientConfigSaveResult | null
  saving: boolean
}): React.JSX.Element | null {
  if (saving || !result) {
    return null
  }
  if (!result.ok) {
    const encryption = result.errorKind === 'encryption_unavailable'
    return (
      <div className="px-6 pb-1">
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>
            {encryption ? 'Can’t store credentials securely' : 'Couldn’t save settings'}
          </AlertTitle>
          <AlertDescription>
            {encryption
              ? 'cosmos couldn’t access your system’s secure storage, so your credentials weren’t saved. No changes were written. This can happen if the OS keychain is locked or unavailable — try again, or set the values via environment variables instead.'
              : result.message ?? 'Please try again.'}
          </AlertDescription>
        </Alert>
      </div>
    )
  }
  // Success: a transient inline caption, including any force-disconnect note.
  const signedOut: string[] = []
  if (result.disconnected.slack) signedOut.push('Slack')
  if (result.disconnected.jira) signedOut.push('Jira')
  if (result.disconnected.confluence) signedOut.push('Confluence')
  if (result.disconnected['google-calendar']) signedOut.push('Google Cal')
  return (
    <div className="px-6 pb-1" aria-live="polite">
      <p className="flex items-center gap-1.5 text-xs text-primary">
        <Check className="size-3.5" />
        Saved
        {signedOut.length > 0 && (
          <span className="text-muted-foreground">
            — {signedOut.join(', ')} signed out; reconnect from{' '}
            {signedOut.length > 1 ? 'their panels' : 'its panel'}.
          </span>
        )}
      </p>
    </div>
  )
}

/** The four gateable integrations, in canonical order — drives the live-status map. */
type LiveMap = Record<GateableIntegration, LiveStatus>

/** Coerce an unknown `state` string to the known connection vocabulary (defensive). */
function toConnectionState(state: string): ConnectionState {
  return state === 'connecting' || state === 'connected' || state === 'reconnect_needed'
    ? state
    : 'not_connected'
}

/**
 * Subscribe to all four integrations' live connection status while the dialog is `open`
 * (settings-redesign-v1, design §4.3). Seeds from each `getStatus()` and follows
 * `onStatusChanged`; reuses the SAME pushes the panels use (no parallel state machine).
 */
function useLiveStatuses(open: boolean): LiveMap {
  const [map, setMap] = useState<LiveMap>(() => ({
    slack: { state: 'not_connected' },
    jira: { state: 'not_connected' },
    confluence: { state: 'not_connected' },
    'google-calendar': { state: 'not_connected' }
  }))

  useEffect(() => {
    if (!open) {
      return
    }
    const apis: Record<GateableIntegration, IntegrationApi> = {
      slack: window.cosmos.slack,
      jira: window.cosmos.jira,
      confluence: window.cosmos.confluence,
      'google-calendar': window.cosmos.googleCalendar
    }
    const set = (id: GateableIntegration, s: { state: string; siteName?: string; accountName?: string }): void =>
      setMap((prev) => ({
        ...prev,
        [id]: { state: toConnectionState(s.state), siteName: s.siteName, accountName: s.accountName }
      }))
    const offs: Array<() => void> = []
    ;(Object.keys(apis) as GateableIntegration[]).forEach((id) => {
      void apis[id].getStatus().then((s) => set(id, s))
      offs.push(apis[id].onStatusChanged((s) => set(id, s)))
    })
    return () => offs.forEach((off) => off())
  }, [open])

  return map
}

/** The small status-dot atom (design §4.4), reused in the side-nav + connection block. */
function StatusDot({ state }: { state: ConnectionState }): React.JSX.Element {
  if (state === 'connecting') {
    return <Loader2 className="size-3.5 animate-spin text-brand-accent" aria-hidden />
  }
  return (
    <span
      aria-hidden
      className={cn(
        'size-2 rounded-full',
        state === 'connected' && 'bg-brand-accent',
        state === 'reconnect_needed' && 'bg-destructive',
        state === 'not_connected' && 'border border-muted-foreground bg-transparent'
      )}
    />
  )
}

/** One side-nav row (design §2.2): leading icon, label, optional trailing status dot. */
function SettingsTab({
  value,
  icon,
  label,
  dot,
  dimmed
}: {
  value: string
  icon: React.ReactNode
  label: string
  dot?: React.ReactNode
  dimmed?: boolean
}): React.JSX.Element {
  return (
    <TabsTrigger
      value={value}
      className={cn(
        'h-8 w-full justify-start gap-2 rounded-md px-2 text-sm',
        'data-[state=active]:bg-secondary data-[state=active]:text-foreground',
        dimmed && 'text-muted-foreground'
      )}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {dot}
    </TabsTrigger>
  )
}

/**
 * One integration tab's shell (design §4): ① header, ② Enable row (bordered emphasis,
 * top), ③ Connection block, ④ Credentials (passed as children). The same template for
 * all four integrations so they read uniformly.
 */
function IntegrationTab({
  icon,
  title,
  caption,
  integration,
  enabled,
  onEnabledChange,
  live,
  onConnect,
  onDisconnect,
  onCancel,
  children
}: {
  icon: React.ReactNode
  title: string
  caption: string
  integration: GateableIntegration
  enabled: boolean
  onEnabledChange: (on: boolean) => void
  live: LiveStatus
  onConnect: () => void
  onDisconnect: () => void
  onCancel: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const switchId = `enable-${integration}`
  return (
    <div className="space-y-5">
      {/* ① Tab header */}
      <GroupHeader icon={icon} title={title} caption={caption} />

      <div className="border-t border-border" />

      {/* ② Enable row — the primary lever, distinct from Connect (design §4.2/§5). */}
      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card/40 px-3 py-2.5">
        <div className="space-y-0.5">
          <Label htmlFor={switchId} className="text-sm font-medium text-foreground">
            Show in sidebar
          </Label>
          <p className="text-xs text-muted-foreground">
            Adds the {title} icon to the left sidebar. You can enable without connecting.
          </p>
        </div>
        <Switch
          id={switchId}
          checked={enabled}
          onCheckedChange={onEnabledChange}
          aria-label={`Show ${title} in sidebar`}
        />
      </div>

      <div className="border-t border-border" />

      {/* ③ Connection block */}
      <ConnectionBlock live={live} onConnect={onConnect} onDisconnect={onDisconnect} onCancel={onCancel} />

      <div className="border-t border-border" />

      {/* ④ Credentials (reused IdField/SecretField via children) */}
      <div className="space-y-3">{children}</div>
    </div>
  )
}

/**
 * The connection status + connect/disconnect action (design §4.3). Reuses the existing
 * `window.cosmos.<int>.connect/disconnect` (passed in) — no parallel connect path.
 */
function ConnectionBlock({
  live,
  onConnect,
  onDisconnect,
  onCancel
}: {
  live: LiveStatus
  onConnect: () => void
  onDisconnect: () => void
  onCancel: () => void
}): React.JSX.Element {
  const { state } = live
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm" aria-live="polite">
        <StatusDot state={state} />
        <span
          className={cn(
            state === 'connected' && 'text-foreground',
            state === 'reconnect_needed' && 'text-destructive',
            (state === 'not_connected' || state === 'connecting') && 'text-muted-foreground'
          )}
        >
          {state === 'connected' && 'Connected'}
          {state === 'connecting' && 'Connecting…'}
          {state === 'reconnect_needed' && 'Reconnect needed'}
          {state === 'not_connected' && 'Not connected'}
        </span>
        {state === 'connected' && (live.siteName || live.accountName) && (
          <span className="text-muted-foreground">· {live.siteName ?? live.accountName}</span>
        )}
      </div>
      {state === 'connected' ? (
        <Button size="sm" variant="outline" onClick={onDisconnect}>
          Disconnect
        </Button>
      ) : state === 'connecting' ? (
        // oauth-cancel-v1: a Cancel affordance aborts an in-flight connect (cancelled browser
        // consent) so the row returns to not_connected immediately instead of staying stuck
        // on "Connecting…" for the full OAuth timeout.
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Connecting…
          </span>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button size="sm" onClick={onConnect}>
          {state === 'reconnect_needed' ? 'Reconnect' : 'Connect'}
        </Button>
      )}
    </div>
  )
}

/**
 * The quiet shared-credentials banner shown on BOTH the Jira and Confluence tabs
 * (design §7): credentials are shared (editing here affects the other product), while
 * connections stay independent. Informational styling, not a warning.
 */
function SharedAtlassianBanner({
  thisProduct,
  otherProduct
}: {
  thisProduct: string
  otherProduct: string
}): React.JSX.Element {
  return (
    <Alert className="border-border bg-muted/40 text-muted-foreground">
      <Link2 className="size-4" />
      <AlertTitle>Shared Atlassian credentials</AlertTitle>
      <AlertDescription>
        {thisProduct} and {otherProduct} use one Atlassian OAuth client. Editing these fields
        here also affects {otherProduct} — saving a change signs out both, and you’ll reconnect
        each from its own tab.
      </AlertDescription>
    </Alert>
  )
}

/** The shared Atlassian Client ID + write-only secret, on both the Jira/Confluence tabs. */
function AtlassianCredentials({
  status,
  saving,
  atlassianIdValue,
  atlassianIdChanged,
  secretDraft,
  secretChanged,
  connected,
  onIdChange,
  onSecretDraftChange,
  clearField
}: {
  status: ClientConfigStatus
  saving: boolean
  atlassianIdValue: string
  atlassianIdChanged: boolean
  secretDraft: string | null
  secretChanged: boolean
  connected: SettingsDialogProps['connected']
  onIdChange: (next: string) => void
  onSecretDraftChange: (next: string | null) => void
  clearField: (field: ClientConfigField) => void
}): React.JSX.Element {
  return (
    <>
      <IdField
        id="atlassian-client-id"
        label="Client ID"
        placeholder="Paste your Atlassian client ID"
        value={atlassianIdValue}
        source={status.atlassian.clientIdSource}
        disabled={saving}
        onChange={onIdChange}
        onReset={() => clearField('atlassian.clientId')}
        resetLabel="Reset Atlassian Client ID to .env default"
        consequence={
          atlassianIdChanged && (connected.jira || connected.confluence)
            ? 'Saving will sign out Jira and Confluence — you’ll need to reconnect.'
            : null
        }
      />
      <SecretField
        id="atlassian-client-secret"
        clearAriaLabel="Clear Atlassian client secret"
        configured={status.atlassian.secretConfigured}
        source={status.atlassian.secretSource}
        disabled={saving}
        draft={secretDraft}
        onDraftChange={onSecretDraftChange}
        onClear={() => clearField('atlassian.clientSecret')}
        consequence={
          secretChanged && (connected.jira || connected.confluence)
            ? 'Saving will sign out Jira and Confluence — you’ll need to reconnect.'
            : null
        }
      />
    </>
  )
}

/**
 * The General tab (design §2.4): an orienting caption + a read-only at-a-glance list of
 * every integration's sidebar/connection state. Static rows (the toggle + connect live
 * on each integration's own tab); this is a dashboard, not a control surface.
 */
function GeneralTab({
  enabled,
  liveStatus
}: {
  enabled: EnabledIntegrations
  liveStatus: LiveMap
}): React.JSX.Element {
  const rows: { id: GateableIntegration; label: string; icon: React.ReactNode }[] = [
    { id: 'slack', label: 'Slack', icon: <SiSlack className="size-4" /> },
    { id: 'jira', label: 'Jira', icon: <SiJira className="size-4" /> },
    { id: 'confluence', label: 'Confluence', icon: <SiConfluence className="size-4" /> },
    { id: 'google-calendar', label: 'Google Cal', icon: <CalendarDays className="size-4" /> }
  ]
  return (
    <div className="space-y-5">
      <div className="space-y-0.5">
        <h3 className="text-sm font-medium text-foreground">Integrations</h3>
        <p className="text-xs text-muted-foreground">
          Turn integrations on to add their panel to the sidebar, then connect each from its own
          tab.
        </p>
      </div>
      <div className="space-y-1">
        {rows.map(({ id, label, icon }) => (
          <div
            key={id}
            className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm"
          >
            <span className="flex items-center gap-2 text-foreground">
              {icon}
              {label}
            </span>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant={enabled[id] ? 'secondary' : 'outline'}>
                {enabled[id] ? 'In sidebar' : 'Hidden'}
              </Badge>
              <StatusDot state={liveStatus[id].state} />
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
