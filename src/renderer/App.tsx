import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Settings } from 'lucide-react'
import { SiConfluence, SiGooglecalendar, SiJira, SiSlack } from 'react-icons/si'
import { siClaudecode } from 'simple-icons'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { TerminalPanel } from './terminal/TerminalPanel'
import { CosmosPanel } from './cosmos/CosmosPanel'
import { SlackPanel } from './slack/SlackPanel'
import { JiraPanel } from './jira/JiraPanel'
import { ConfluencePanel } from './confluence/ConfluencePanel'
import { GoogleCalendarPanel } from './calendar/GoogleCalendarPanel'
import { SettingsDialog } from './SettingsDialog'
import { CosmosSpinner } from './CosmosSpinner'
import { SessionProvider, useEnabledIntegrations, useLoadSession } from './session/SessionProvider'
import { OpenPromptPositionProvider } from './OpenPromptPositionProvider'
import {
  ActiveComposerProvider,
  useActiveComposerConfig
} from './ActiveComposerProvider'
import { PromptComposer } from './PromptComposer'
import { composerModeForSurface } from './activeComposer'
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
 * settings-redesign-v1 (FR-004/FR-005): only Terminal + Cosmos are always in
 * the rail; the four integrations show only when `enabled` (their panels stay mounted
 * regardless, so a re-enable is instant). `SurfaceId` is the shared rail type.
 */

// Icons mix the inline CosmosMark (Cosmos brand sparkle), react-icons/si brand logos
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

// Cosmos rail glyph: the `cosmos-small-white.svg` four-point sparkle, MONOCHROME — the colored
// background rect + radial gradient are dropped and the mark is `fill="currentColor"` so it tracks
// the rail's active/idle color cascade exactly like the other rail icons (not the pastel brand mark).
const CosmosGlyphIcon: RailIcon = ({ className }) => (
  <svg role="img" viewBox="80 80 352 352" className={className} fill="currentColor" aria-hidden>
    <g transform="translate(256,256) scale(2.78)">
      <path d="M 0.00 -60.00 Q 9.55 -47.99 9.18 -22.17 Q 27.18 -40.68 42.43 -42.43 Q 40.68 -27.18 22.17 -9.18 Q 47.99 -9.55 60.00 0.00 Q 47.99 9.55 22.17 9.18 Q 40.68 27.18 42.43 42.43 Q 27.18 40.68 9.18 22.17 Q 9.55 47.99 0.00 60.00 Q -9.55 47.99 -9.18 22.17 Q -27.18 40.68 -42.43 42.43 Q -40.68 27.18 -22.17 9.18 Q -47.99 9.55 -60.00 0.00 Q -47.99 -9.55 -22.17 -9.18 Q -40.68 -27.18 -42.43 -42.43 Q -27.18 -40.68 -9.18 -22.17 Q -9.55 -47.99 0.00 -60.00 Z" />
    </g>
  </svg>
)

/** The rail item presentation for every surface, keyed by id (order = ALL_SURFACE_IDS). */
const RAIL_ITEM: Record<SurfaceId, { label: string; Icon: RailIcon }> = {
  terminal: { label: 'Terminal', Icon: ClaudeCodeIcon },
  // cosmos-conversation-panel-v1: the rail id is 'cosmos' (renamed from 'generated-ui'); the WIRE
  // render target stays 'generated-ui' (see CosmosPanel + railVisibility). Brand mark = CosmosMark.
  cosmos: { label: 'Cosmos', Icon: CosmosGlyphIcon },
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
      {/* draggable-open-prompt-button-v1 (FR-003): the global Open-Prompt button position
          store. Inside SessionProvider so it seeds from the restored snapshot and reports
          through the shared SessionRegistry; wraps the whole shell so every panel's
          PromptComposer reads the one shared position. */}
      <OpenPromptPositionProvider>
        {/* open-prompt-hoist-v1: the active-composer registry wraps BOTH the panels
            (which publish their per-surface composer wiring) and the ONE hoisted
            PromptComposer the shell renders, so switching panels never re-mounts the
            composer (no flicker) while the submit still routes to the active surface. */}
        <ActiveComposerProvider>
          <AppShell />
        </ActiveComposerProvider>
      </OpenPromptPositionProvider>
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

  // open-prompt-hoist-v1: the stable surface-region element the single hoisted composer
  // measures + positions its floating button within (constant across panel switches).
  const surfaceRef = useRef<HTMLDivElement | null>(null)

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
        {/* titlebar: the custom window-chrome strip. The native title bar is removed in main
            (`titleBarStyle: 'hidden'`), so this thin bar IS the top chrome. `bg-background` matches
            the app/panel surface so it reads as one seamless surface (NOT a contrasting color bar);
            the centered "cosmos" wordmark is the app title. Height (28px) matches main's
            `trafficLightPosition` so the macOS traffic lights center in it. `WebkitAppRegion: drag`
            makes the bar drag the window (interactive children would need `no-drag`). On Windows/
            Linux there are no traffic lights — it still renders as a draggable title bar. */}
        <div
          className="flex h-7 shrink-0 items-center justify-center bg-background select-none"
          style={{ WebkitAppRegion: 'drag' } as CSSProperties}
        >
          <span className="text-xs font-medium tracking-wide text-muted-foreground">cosmos</span>
        </div>
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
                      'before:absolute before:left-[-8px] before:top-0 before:bottom-0 before:w-[3px] before:rounded-full before:bg-primary before:opacity-0',
                      // Neutralize the default vertical line variant after-indicator.
                      'after:hidden',
                      // Active: --secondary filled pill + PRIMARY-colored icon + show the bar.
                      // `bg-secondary!` beats the line variant's unconditional
                      // group-data-[variant=line]/tabs-list:bg-transparent (tabs.tsx:66);
                      // `text-primary!` beats the base `dark:text-muted-foreground` idle
                      // color, which out-specifies a plain class. tailwind-merge can't dedupe
                      // either variant-prefixed rule, so both need the trailing-`!`.
                      isActive && 'bg-secondary! text-primary! before:opacity-100'
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

          {/* open-prompt-hoist-v1: a STABLE surface-region wrapper that spans the whole
              main area beside the rail. It is the box the ONE hoisted PromptComposer
              measures + positions its floating button within (`surfaceRef`); because it
              is the same element across panel switches, the composer never re-measures on
              a switch (no flicker). `relative` so the composer overlay anchors to it. */}
          <div ref={surfaceRef} className="relative flex min-w-0 flex-1 flex-col">
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
              value="cosmos"
              forceMount
              className="app__ui data-[state=inactive]:hidden"
            >
              <CosmosPanel active={surface === 'cosmos'} />
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

            {/* The ONE hoisted Open-Prompt composer, routed to the active surface. */}
            <SharedComposer surface={surface} surfaceRef={surfaceRef} />
          </div>
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

/**
 * open-prompt-hoist-v1: the ONE hoisted Open-Prompt composer. It reads the ACTIVE
 * surface's published composer wiring from the registry (`useActiveComposerConfig`) and
 * renders a SINGLE `PromptComposer` over the surface region — so there is exactly one
 * floating button + one shared draft + one shared drag/position, mounted once at the App
 * level. The submit routes to whichever panel is active (its published `onSubmit`); a
 * surface with no published composer (Terminal, or a disconnected integration) renders
 * nothing. It overlays the surface region (`absolute inset-0`, pointer-events-none) so
 * the panel content behind stays clickable; the composer re-enables pointer events only
 * on its own button/card. `surfaceRef` is the stable box it measures + positions within.
 */
function SharedComposer({
  surface,
  surfaceRef
}: {
  surface: SurfaceId
  surfaceRef: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element | null {
  const config = useActiveComposerConfig(surface)
  // cosmos-open-prompt-pinned-v1 (OQ-1 Option A): the per-surface render mode is a pure
  // function of the ACTIVE surface — Cosmos ⇒ docked, everything else ⇒ floating. The mode is
  // computed BEFORE the early return so the hook order is identical to the old version; the
  // single `PromptComposer` instance stays mounted (no `key={surface}`) so its draft never
  // resets on a panel switch.
  const mode = composerModeForSurface(surface)
  if (!config) {
    return null
  }
  const composer = (
    <PromptComposer
      // NO `key={surface}`: the single instance MUST stay mounted across panel switches
      // so it never re-measures (the whole point of the hoist — no flicker). The draft +
      // collapsed/expanded + drag state are therefore genuinely shared across surfaces;
      // the submit routes to the active surface via the published `onSubmit` (open-prompt-hoist-v1).
      panelRef={surfaceRef}
      mode={mode}
      // OQ-2: auto-focus the docked Cosmos input on activation (only relevant when docked).
      autoFocusActive={mode === 'docked' && surface === 'cosmos'}
      onSubmit={config.onSubmit}
      placeholder={config.placeholder}
      ariaLabel={config.ariaLabel}
      {...(config.contextChip ? { contextChip: config.contextChip } : {})}
      busy={config.busy ?? false}
    />
  )
  // cosmos-open-prompt-pinned-v1 (design §1.2, INSET refinement): branch ONLY the WRAPPER on mode.
  //  - docked (Cosmos): an in-flow, `shrink-0` bottom slot — the LAST flex child of the
  //    `surfaceRef` column, sitting below the active panel content. The composer body inside is an
  //    INSET, rounded card CONSTRAINED to the SAME width as the floating composer (`max-w-2xl`) and
  //    CENTERED, so the docked input reads identically sized to the composer on the other panels —
  //    just pinned at the bottom with a comfortable bottom margin. The wrapper centers
  //    (`flex justify-center` + side/bottom padding); the width cap (`max-w-2xl`) lives on the body.
  //    COLOR-SEAM FIX: this band is a SIBLING below the Cosmos `<section>` (which is `bg-card border-l`),
  //    so without a surface of its own it would expose the app `bg-background` underneath — a visible
  //    seam where the panel's bottom area differs from its top. Carry the SAME `bg-card` + `border-l
  //    border-border` so the panel surface reads as ONE continuous color from tab strip to the bottom
  //    edge. `pt-3` gives breathing room above the card; `pb-6` is the bottom margin the user wants
  //    (a clearly larger gap below the card and the panel's bottom edge).
  //  - floating (every other surface): today's `pointer-events-none absolute inset-0` overlay,
  //    left byte-for-byte unchanged so the other four panels' composer is untouched (FR-011).
  if (mode === 'docked') {
    return (
      <div className="flex shrink-0 justify-center border-l border-border bg-card px-3 pb-6 pt-3">
        {composer}
      </div>
    )
  }
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-end">{composer}</div>
  )
}
