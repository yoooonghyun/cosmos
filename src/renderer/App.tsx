import { useEffect, useMemo, useRef, useState } from 'react'
import { Settings, Sparkles } from 'lucide-react'
import { SiConfluence, SiGooglecalendar, SiJira, SiSlack } from 'react-icons/si'
import { siClaudecode } from 'simple-icons'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { TerminalPanel } from './TerminalPanel'
import { GeneratedUiPanel } from './GeneratedUiPanel'
import { SlackPanel } from './SlackPanel'
import { JiraPanel } from './JiraPanel'
import { ConfluencePanel } from './ConfluencePanel'
import { GoogleCalendarPanel } from './GoogleCalendarPanel'
import { SettingsDialog } from './SettingsDialog'
import { CosmosSpinner } from './CosmosSpinner'
import { SessionProvider, useEnabledIntegrations, useLoadSession } from './SessionProvider'
import { resolveFallbackSurface, visibleSurfaceIds, type SurfaceId } from './railVisibility'
import './App.css'

/**
 * App shell (design §1): left VS Code-style icon rail | one full-width surface.
 * The rail and surface region are a Radix vertical `Tabs`: the `TabsList` is the
 * rail (a single-surface switcher), and exactly one surface fills the main area.
 * All six `TabsContent` panels are kept mounted via `forceMount` (hidden when
 * inactive) so switching only toggles visibility — the Terminal's live PTY
 * session and any pending render_ui surface are never torn down.
 *
 * settings-redesign-v1 (FR-004/FR-005): only Terminal + Generated UI are always in
 * the rail; the four integrations show only when `enabled` (their panels stay mounted
 * regardless, so a re-enable is instant). `SurfaceId` is the shared rail type.
 */

// Icons mix lucide (Generated UI → Sparkles), react-icons/si brand logos
// (Jira/Confluence/Slack/Google Calendar), and the Claude Code logo from simple-icons (its own
// mark, distinct from the Claude sunburst). All render an SVG that accepts
// `className` and inherits `currentColor`, so the rail's active/idle color cascade
// is identical; type the slot as a className-accepting component.
type RailIcon = React.ComponentType<{ className?: string }>

// simple-icons ships raw SVG path data (no React component), so wrap the Claude
// Code mark in a currentColor SVG matching the react-icons/lucide contract.
const ClaudeCodeIcon: RailIcon = ({ className }) => (
  <svg role="img" viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
    <path d={siClaudecode.path} />
  </svg>
)

/** The rail item presentation for every surface, keyed by id (order = ALL_SURFACE_IDS). */
const RAIL_ITEM: Record<SurfaceId, { label: string; Icon: RailIcon }> = {
  terminal: { label: 'Terminal', Icon: ClaudeCodeIcon },
  'generated-ui': { label: 'Generated UI', Icon: Sparkles },
  slack: { label: 'Slack', Icon: SiSlack },
  jira: { label: 'Jira', Icon: SiJira },
  confluence: { label: 'Confluence', Icon: SiConfluence },
  'google-calendar': { label: 'Google Calendar', Icon: SiGooglecalendar }
}

/**
 * Outer App: gate the rail behind the one-time session restore (D3). While the
 * snapshot loads, show a brief "restoring…" spinner; once it resolves (a snapshot or
 * a clean null), render the panels inside the `SessionProvider` so each seeds its
 * restored tab state and reports changes to the debounced save coordinator.
 */
export function App(): React.JSX.Element {
  const { loading, snapshot } = useLoadSession()

  if (loading) {
    return (
      <div
        className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-background text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        <CosmosSpinner className="size-8 text-primary" />
        <span className="text-[13px]">Restoring your session…</span>
      </div>
    )
  }

  return (
    <SessionProvider snapshot={snapshot}>
      <AppShell />
    </SessionProvider>
  )
}

/**
 * settings-oauth-clients-v1 (design §F) — track each integration's LIVE connection
 * state so the Settings dialog can decide the force-disconnect caption/confirm
 * precisely. Subscribes to the same `*:statusChanged` pushes the panels use and seeds
 * from the current status, mirroring `state === 'connected'`.
 */
function useConnectedStatus(): {
  slack: boolean
  jira: boolean
  confluence: boolean
  google: boolean
} {
  const [connected, setConnected] = useState({
    slack: false,
    jira: false,
    confluence: false,
    google: false
  })
  useEffect(() => {
    const set = (key: 'slack' | 'jira' | 'confluence' | 'google', state: string): void =>
      setConnected((prev) =>
        prev[key] === (state === 'connected') ? prev : { ...prev, [key]: state === 'connected' }
      )
    void window.cosmos.slack.getStatus().then((s) => set('slack', s.state))
    void window.cosmos.jira.getStatus().then((s) => set('jira', s.state))
    void window.cosmos.confluence.getStatus().then((s) => set('confluence', s.state))
    void window.cosmos.googleCalendar.getStatus().then((s) => set('google', s.state))
    const offSlack = window.cosmos.slack.onStatusChanged((s) => set('slack', s.state))
    const offJira = window.cosmos.jira.onStatusChanged((s) => set('jira', s.state))
    const offConfluence = window.cosmos.confluence.onStatusChanged((s) =>
      set('confluence', s.state)
    )
    const offGoogle = window.cosmos.googleCalendar.onStatusChanged((s) => set('google', s.state))
    return () => {
      offSlack()
      offJira()
      offConfluence()
      offGoogle()
    }
  }, [])
  return connected
}

function AppShell(): React.JSX.Element {
  const [surface, setSurface] = useState<SurfaceId>('terminal')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const connected = useConnectedStatus()
  const { enabled, setEnabled } = useEnabledIntegrations()

  // The ordered visible rail surfaces (always-present + enabled gateable; FR-004/FR-005).
  const visibleIds = useMemo(() => visibleSurfaceIds(enabled), [enabled])

  // FR-014/SC-007: when the active surface gets disabled (no longer visible), fall
  // focus back to Terminal so the user never stares at a hidden panel. Runs whenever
  // the visible set changes; a no-op when the active surface is still visible.
  useEffect(() => {
    setSurface((prev) => resolveFallbackSurface(prev, enabled, visibleIds))
  }, [enabled, visibleIds])

  // Left-rail surface switching via Cmd+Shift+] / Cmd+Shift+[ (matched in main,
  // delivered over `shortcuts.onTrigger`). The cycle MUST range over the CURRENTLY
  // VISIBLE rail items only (settings-redesign-v1 §8.5) so a hidden integration is
  // never reachable by keyboard. A ref holds the latest visible list so the handler
  // (bound once) always cycles the current set without re-subscribing. The per-surface
  // tab shortcuts (Cmd+T/W, cycle, jump) are handled inside each panel.
  const visibleRef = useRef(visibleIds)
  visibleRef.current = visibleIds
  useEffect(() => {
    const off = window.cosmos.shortcuts.onTrigger((payload) => {
      if (payload.command !== 'surface:next' && payload.command !== 'surface:prev') {
        return
      }
      const delta = payload.command === 'surface:next' ? 1 : -1
      setSurface((prev) => {
        const list = visibleRef.current
        const i = list.indexOf(prev)
        // If the active surface somehow isn't in the visible list, start from 0.
        const base = i < 0 ? 0 : i
        const next = (base + delta + list.length) % list.length
        return list[next]
      })
    })
    return off
  }, [])

  return (
    <TooltipProvider delayDuration={300}>
      <div className="app">
        <header className="app__header">
          <span className="app__title">cosmos</span>
          <span className="app__subtitle">
            Terminal Panel · Generated UI · Slack · Jira · Confluence · Claude Code
          </span>
        </header>
        <Tabs
          orientation="vertical"
          value={surface}
          onValueChange={(v) => setSurface(v as SurfaceId)}
          className="app__body !gap-0"
        >
          {/* Left icon rail (~48px) — VS Code activity bar idiom. */}
          <TabsList
            variant="line"
            className="h-full! w-12 shrink-0 justify-start gap-1 rounded-none border-r border-border bg-popover p-0 py-2"
            aria-label="Surfaces"
          >
            {visibleIds.map((id) => {
              const { label, Icon } = RAIL_ITEM[id]
              // Drive the active highlight from React state (surface === id), NOT
              // `data-[state=active]:*`: the `TooltipTrigger asChild` Slot spreads the
              // Tooltip's own `data-state` ("closed"/"delayed-open"/"instant-open") AFTER
              // the Tabs Trigger's `data-state`, so the rendered <button>'s `data-state` is
              // ALWAYS the tooltip's value and never "active" — every `data-[state=active]:`
              // class (and the line variant's `data-[state=active]:bg-transparent`) is dead.
              const isActive = surface === id
              return (
              <Tooltip key={id}>
                <TooltipTrigger asChild>
                  <TabsTrigger
                    value={id}
                    aria-label={label}
                    className={cn(
                      'relative h-10 w-10 flex-none items-center justify-center rounded-md p-0',
                      // The vertical Tabs base forces justify-start + w-full; re-center
                      // and re-square via the same variant so the icon sits centered.
                      'group-data-[orientation=vertical]/tabs:w-10 group-data-[orientation=vertical]/tabs:justify-center',
                      'text-muted-foreground hover:text-foreground',
                      // Primary left indicator bar (3px, full height), hidden until active.
                      'before:absolute before:left-[-8px] before:top-0 before:bottom-0 before:w-[3px] before:rounded-full before:bg-brand-accent before:opacity-0',
                      // Neutralize the default vertical line variant after-indicator.
                      'after:hidden',
                      // Active: --secondary filled pill + foreground icon + show the bar.
                      // `bg-secondary!` beats the line variant's unconditional
                      // group-data-[variant=line]/tabs-list:bg-transparent (tabs.tsx:66);
                      // `text-foreground!` beats the base `dark:text-muted-foreground` idle
                      // color, which out-specifies a plain class. tailwind-merge can't dedupe
                      // either variant-prefixed rule, so both need the trailing-`!`.
                      isActive && 'bg-secondary! text-foreground! before:opacity-100'
                    )}
                  >
                    <Icon className="size-5" />
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
              )
            })}

            {/* Spacer sinks the Settings gear to the bottom of the rail. */}
            <div className="flex-1" aria-hidden />

            {/* settings-oauth-clients-v1 (design §A): the Settings gear. A plain ghost
                Button (NOT a TabsTrigger), so Radix never folds it into the tab
                roving-tabindex and it never shows the surface primary-indicator bar.
                A direct rail child like the triggers so the list's `items-center` +
                `gap-1` align it identically; the `flex-1` spacer above pins it bottom. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Settings"
                  onClick={() => setSettingsOpen(true)}
                  className={cn(
                    // Match the rail triggers: hover brightens the ICON only, no bg box.
                    // The ghost variant's hover:bg-accent is neutralized; the filled box
                    // appears only while the dialog is open (active state).
                    'h-10 w-10 flex-none rounded-md text-muted-foreground hover:bg-transparent hover:text-foreground',
                    settingsOpen && 'bg-accent text-foreground'
                  )}
                >
                  <Settings className="size-6" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Settings</TooltipContent>
            </Tooltip>
          </TabsList>

          {/* The selected surface fills the main area. All five are kept mounted
              (forceMount) and only hidden when inactive, so the Terminal's live
              PTY session and a pending render_ui surface survive a switch. */}
          <TabsContent
            value="terminal"
            forceMount
            className="app__ui data-[state=inactive]:hidden"
          >
            <TerminalPanel active={surface === 'terminal'} />
          </TabsContent>
          <TabsContent
            value="generated-ui"
            forceMount
            className="app__ui data-[state=inactive]:hidden"
          >
            <GeneratedUiPanel active={surface === 'generated-ui'} />
          </TabsContent>
          <TabsContent value="slack" forceMount className="app__ui data-[state=inactive]:hidden">
            <SlackPanel active={surface === 'slack'} />
          </TabsContent>
          <TabsContent value="jira" forceMount className="app__ui data-[state=inactive]:hidden">
            {/* Jira generative-UI v2 (D4): the panel is force-mounted, so it learns
                it became the active rail surface from this prop and triggers the
                per-switch default-view refresh AND scopes its tab shortcuts. */}
            <JiraPanel active={surface === 'jira'} />
          </TabsContent>
          <TabsContent value="confluence" forceMount className="app__ui data-[state=inactive]:hidden">
            <ConfluencePanel active={surface === 'confluence'} />
          </TabsContent>
          <TabsContent
            value="google-calendar"
            forceMount
            className="app__ui data-[state=inactive]:hidden"
          >
            {/* Google Calendar integration v1 (FR-014): force-mounted, so it learns it
                became the active rail surface from this prop and triggers the per-switch
                default-view refresh AND scopes its tab shortcuts. */}
            <GoogleCalendarPanel active={surface === 'google-calendar'} />
          </TabsContent>
        </Tabs>
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          connected={connected}
          enabled={enabled}
          onEnabledChange={setEnabled}
        />
      </div>
    </TooltipProvider>
  )
}
