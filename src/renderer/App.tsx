import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { SiConfluence, SiJira, SiSlack } from 'react-icons/si'
import { siClaudecode } from 'simple-icons'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { TerminalPanel } from './TerminalPanel'
import { GeneratedUiPanel } from './GeneratedUiPanel'
import { SlackPanel } from './SlackPanel'
import { JiraPanel } from './JiraPanel'
import { ConfluencePanel } from './ConfluencePanel'
import { CosmosSpinner } from './CosmosSpinner'
import { SessionProvider, useLoadSession } from './SessionProvider'
import './App.css'

/**
 * App shell (design §1): left VS Code-style icon rail | one full-width surface.
 * The rail and surface region are a Radix vertical `Tabs`: the `TabsList` is the
 * rail (a single-surface switcher), and exactly one surface fills the main area.
 * All five `TabsContent` panels are kept mounted via `forceMount` (hidden when
 * inactive) so switching only toggles visibility — the Terminal's live PTY
 * session and any pending render_ui surface are never torn down.
 */
type SurfaceId = 'terminal' | 'generated-ui' | 'slack' | 'jira' | 'confluence'

// Icons mix lucide (Generated UI → Sparkles), react-icons/si brand logos
// (Jira/Confluence/Slack), and the Claude Code logo from simple-icons (its own
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

const RAIL_ITEMS: { id: SurfaceId; label: string; Icon: RailIcon }[] = [
  { id: 'terminal', label: 'Terminal', Icon: ClaudeCodeIcon },
  { id: 'generated-ui', label: 'Generated UI', Icon: Sparkles },
  { id: 'slack', label: 'Slack', Icon: SiSlack },
  { id: 'jira', label: 'Jira', Icon: SiJira },
  { id: 'confluence', label: 'Confluence', Icon: SiConfluence }
]

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

function AppShell(): React.JSX.Element {
  const [surface, setSurface] = useState<SurfaceId>('terminal')

  // Left-rail surface switching via Cmd+Shift+] / Cmd+Shift+[ (matched in main,
  // delivered over `shortcuts.onTrigger`). Bind once; functional setState wraps
  // around RAIL_ITEMS without needing the current surface in the closure. The
  // per-surface tab shortcuts (Cmd+T/W, cycle, jump) are handled inside each panel.
  useEffect(() => {
    const off = window.cosmos.shortcuts.onTrigger((payload) => {
      if (payload.command !== 'surface:next' && payload.command !== 'surface:prev') {
        return
      }
      const delta = payload.command === 'surface:next' ? 1 : -1
      setSurface((prev) => {
        const i = RAIL_ITEMS.findIndex((it) => it.id === prev)
        const next = (i + delta + RAIL_ITEMS.length) % RAIL_ITEMS.length
        return RAIL_ITEMS[next].id
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
            className="h-full w-12 shrink-0 justify-start gap-1 rounded-none border-r border-border bg-popover p-0 py-2"
            aria-label="Surfaces"
          >
            {RAIL_ITEMS.map(({ id, label, Icon }) => {
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
        </Tabs>
      </div>
    </TooltipProvider>
  )
}
