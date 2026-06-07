import { useEffect, useState } from 'react'
import { BookText, MessageSquare, Sparkles, SquareKanban, SquareTerminal } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { TerminalPanel } from './TerminalPanel'
import { GeneratedUiPanel } from './GeneratedUiPanel'
import { SlackPanel } from './SlackPanel'
import { JiraPanel } from './JiraPanel'
import { ConfluencePanel } from './ConfluencePanel'
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

const RAIL_ITEMS: { id: SurfaceId; label: string; Icon: typeof Sparkles }[] = [
  { id: 'terminal', label: 'Terminal', Icon: SquareTerminal },
  { id: 'generated-ui', label: 'Generated UI', Icon: Sparkles },
  { id: 'slack', label: 'Slack', Icon: MessageSquare },
  { id: 'jira', label: 'Jira', Icon: SquareKanban },
  { id: 'confluence', label: 'Confluence', Icon: BookText }
]

export function App(): React.JSX.Element {
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
            {RAIL_ITEMS.map(({ id, label, Icon }) => (
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
                      // Active: foreground icon + 2px primary left indicator bar.
                      'data-[state=active]:text-foreground data-[state=active]:bg-transparent',
                      'before:absolute before:left-[-8px] before:top-1 before:bottom-1 before:w-0.5 before:rounded-full before:bg-primary before:opacity-0 data-[state=active]:before:opacity-100',
                      // Neutralize the default vertical line variant after-indicator.
                      'after:hidden'
                    )}
                  >
                    <Icon className="size-5" />
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
            ))}
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
