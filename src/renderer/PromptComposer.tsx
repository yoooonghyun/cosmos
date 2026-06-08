/**
 * PromptComposer — the single SHARED collapsible prompt composer reused by all four
 * generative panels (Generated UI, Jira, Slack, Confluence)
 * (collapsible-prompt-composer-v1, FR-015). The four panels previously each carried a
 * byte-for-byte duplicate of an always-on, full-width composer; this replaces all of
 * them with ONE component that has two mutually-exclusive states (FR-002):
 *
 *   - COLLAPSED (default, FR-001): a centered cosmos-logo button at the bottom.
 *   - EXPANDED (FR-010): a centered, `max-w-2xl` composer card (textarea + Send) that
 *     morphs up out of the logo's position.
 *
 * Both states are ALWAYS mounted in one zero-height overlay slot and cross-faded via the
 * `expanded` flag, so the open/close transition fires in both directions (FR-004) —
 * conditional mount/unmount would skip the enter/exit animation. They remain mutually
 * exclusive to the user (FR-002/SC-007): the hidden state is `inert` + `pointer-events-none`
 * + `tabIndex=-1`, so focus, clicks, and AT only ever reach the visible one. Clicking the
 * logo opens (open-only, FR-003); a successful submit (FR-006), Esc (FR-007), or a click
 * outside the composer (FR-008) collapses back. Pure decision logic lives in
 * `./promptComposerLogic.ts` so this file stays a thin shell over node-testable helpers
 * (CLAUDE.md `.ts`/`.test.ts` split).
 *
 * OQ-1: the inline status/error block is REMOVED — run/error status surfaces via the
 * always-visible `PanelTabStrip` glyph + `PanelFooter` run-status glyph. The
 * `agent.onStatus` subscription is kept only to drive the mid-run `running` disable
 * (FR-005/FR-019) and the optional collapsed-logo error ring (design §3.4).
 * OQ-2: the typed draft is PRESERVED across dismiss (Esc / click-outside) and restored
 * on re-open; cleared only on a successful submit (FR-018).
 * OQ-3: collapsing mid-run is allowed (the dismiss paths ignore `running`, FR-019).
 *
 * Animation (design §4): Tailwind-core transitions only (NOT tw-animate-css, which is
 * not installed). Coordinated opacity + scale + translate-y, `origin-bottom`, open
 * ~200ms ease-out / close ~150ms ease-in, with a `motion-reduce:` instant-swap fallback.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent
} from 'react'
import type { AgentStatusPayload } from '../shared/ipc'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { CosmosMark } from './CosmosMark'
import {
  submitDecision,
  draftAfterDismiss,
  draftAfterSubmit,
  shouldCollapseOnOutsideClick,
  escDecision
} from './promptComposerLogic'

/**
 * Props for the shared composer. Per-panel copy only — no invented props (FR-017 gating
 * stays at the call site; each panel keeps its existing `{isConnected && …}` wrapper).
 */
export interface PromptComposerProps {
  /** Send the raw utterance, exactly as today (the panel hook owns agent.submit + tab bookkeeping). */
  onSubmit: (utterance: string) => void
  /** Per-panel textarea placeholder (e.g. "Describe the UI you want…"). */
  placeholder: string
  /** Per-panel accessible name for the form + textarea (e.g. "Ask about your Jira issues"). */
  ariaLabel: string
  /** Accessible name for the collapsed logo button (FR-013). Defaults to "Open prompt". */
  collapsedAriaLabel?: string
  /**
   * True while THIS panel's active tab has a generation in flight (the same per-tab gate
   * that drives the surface spinner). While busy, the whole composer is hidden — neither the
   * expanded card nor the collapsed logo shows — so the panel is just the spinner; the logo
   * reappears only once generation completes (its surface lands / errors). Default false.
   */
  busy?: boolean
}

/** Shared hint copy under the textarea (design §3.5). */
const HINT_COPY = 'Enter to send · Shift+Enter for newline'

export function PromptComposer({
  onSubmit,
  placeholder,
  ariaLabel,
  collapsedAriaLabel = 'Open prompt',
  busy = false
}: PromptComposerProps): React.JSX.Element {
  // Collapsed/expanded is session-only, default collapsed (FR-001/FR-016).
  const [expanded, setExpanded] = useState(false)
  // The draft is preserved across collapse; cleared only on a successful submit (FR-018/OQ-2).
  const [value, setValue] = useState('')
  // Drives the mid-run disable (FR-005/FR-019); the inline status block is removed (OQ-1).
  const [running, setRunning] = useState(false)
  // Optional collapsed-logo error ring (design §3.4 / R-1) — cleared on the next run start/complete.
  const [hasError, setHasError] = useState(false)
  // Why the composer is collapsing: a submit "launches" (grow-to-fill + vanish), while an
  // Esc/outside-click "dismisses" (a gentle shrink-fade). Only the launch is the dramatic
  // expand the user asked for; a plain dismiss must not look like a send.
  const [launching, setLaunching] = useState(false)

  const logoRef = useRef<HTMLButtonElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)
  // Tracks WHY we collapsed so the focus effect only pulls focus to the logo on an
  // explicit collapse (submit/Esc/outside-click), not on first mount.
  const pendingLogoFocus = useRef(false)

  // Keep the run-status subscription (OQ-1): drives the mid-run disable + the error ring.
  useEffect(() => {
    const off = window.cosmos.agent.onStatus((status: AgentStatusPayload) => {
      switch (status.state) {
        case 'started':
          setRunning(true)
          setHasError(false)
          break
        case 'completed':
          setRunning(false)
          setHasError(false)
          break
        case 'error':
          setRunning(false)
          setHasError(true)
          break
      }
    })
    return off
  }, [])

  // FR-011: on expand, move focus into the textarea so the user can type immediately.
  useLayoutEffect(() => {
    if (expanded) {
      textareaRef.current?.focus()
    }
  }, [expanded])

  // FR-012: on an explicit collapse, return focus to the logo button it collapsed into.
  useLayoutEffect(() => {
    if (!expanded && pendingLogoFocus.current) {
      pendingLogoFocus.current = false
      logoRef.current?.focus()
    }
  }, [expanded])

  const collapse = useCallback((focusLogo: boolean): void => {
    pendingLogoFocus.current = focusLogo
    setExpanded(false)
  }, [])

  // FR-005/FR-006: send only on a non-empty, non-running submit, then auto-collapse +
  // clear the draft + return focus to the logo. Keys off the composer's OWN accept
  // decision (not an agent:status event), so collapse is immediate and deterministic.
  const submit = useCallback((): void => {
    const { accept } = submitDecision({ value, running })
    if (!accept) {
      return
    }
    onSubmit(value)
    setRunning(true)
    setHasError(false)
    setValue(draftAfterSubmit()) // clear only on success (FR-005)
    setLaunching(true) // submit collapse = grow-to-fill + vanish (the "launch")
    collapse(true) // auto-collapse to the logo (FR-006/FR-012)
  }, [value, running, onSubmit, collapse])

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault()
      submit()
    },
    [submit]
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      // Esc collapses while the composer is open + focused (FR-007); takes precedence.
      if (event.key === 'Escape') {
        if (escDecision({ open: expanded, focused: true })) {
          event.preventDefault()
          event.stopPropagation()
          setValue(draftAfterDismiss(value)) // preserve the draft (FR-018/OQ-2)
          setLaunching(false) // dismiss, not a send → gentle exit
          collapse(true)
        }
        return
      }
      // Enter submits; Shift+Enter inserts a newline (FR-005).
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        submit()
      }
    },
    [expanded, value, submit, collapse]
  )

  // FR-008: collapse on a click outside the composer root (scoped to the panel region).
  // The DOM hit-test lives here; only the decision is the pure helper.
  useEffect(() => {
    if (!expanded) {
      return
    }
    const onPointerDown = (event: MouseEvent): void => {
      const root = formRef.current
      const target = event.target as Node | null
      const insideComposer = !!(root && target && root.contains(target))
      if (shouldCollapseOnOutsideClick(insideComposer)) {
        setValue((v) => draftAfterDismiss(v)) // preserve the draft (FR-018/OQ-2)
        setLaunching(false) // dismiss, not a send → gentle exit
        collapse(true)
      }
    }
    // `mousedown` (not click) so the collapse fires before focus shifts elsewhere.
    document.addEventListener('mousedown', onPointerDown, true)
    return () => document.removeEventListener('mousedown', onPointerDown, true)
  }, [expanded, collapse])

  const canSubmit = !running && value.trim().length > 0
  const hasDraft = value.trim().length > 0

  // BOTH states are ALWAYS mounted so the open/close CSS transition fires in both
  // directions (FR-004): conditional mount/unmount would skip enter/exit animation.
  // They share one zero-height in-flow overlay slot anchored just above the footer, so
  // the expanded composer floats over the content (tickets stay full-height behind it)
  // and the collapsed logo has NO in-flow band of its own. `expanded` cross-fades /
  // morphs between them; the hidden one is `inert` + non-interactive so focus and clicks
  // only ever reach the visible state (FR-002/SC-007). The surround is transparent +
  // pointer-events-none so clicks pass through to the content behind.
  return (
    <div className="relative shrink-0">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex min-h-[4.5rem] items-end justify-center px-3 pb-3 pt-2">
        {/* COLLAPSED: centered cosmos-logo button (FR-001), absolutely centered so it
            occupies no row of its own and shares the slot with the form. */}
        <div
          inert={expanded || busy}
          aria-hidden={expanded || busy}
          className={[
            'absolute bottom-3 left-1/2 -translate-x-1/2',
            // No transform/scale animation on the logo itself — the expand/collapse motion
            // lives entirely on the composer; the logo only fades. The submit motion is
            // grow-and-vanish (the composer expands away rather than shrinking INTO the
            // button). The logo is hidden BOTH while expanded AND while a generation is in
            // flight (`busy`): on submit the composer launches away and the logo stays gone
            // through the whole run, fading back in only once generation completes (the
            // surface lands and `busy` clears).
            'transition-opacity duration-[400ms] ease-[cubic-bezier(0.16,1,0.3,1)]',
            'motion-reduce:transition-none',
            expanded || busy
              ? 'pointer-events-none opacity-0'
              : 'pointer-events-auto opacity-100'
          ].join(' ')}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                ref={logoRef}
                type="button"
                variant="ghost"
                size="icon"
                aria-label={collapsedAriaLabel}
                aria-expanded={false}
                tabIndex={expanded || busy ? -1 : 0}
                onClick={() => {
                  setLaunching(false)
                  setExpanded(true)
                }}
                className={[
                  'relative size-12 rounded-xl border border-border bg-popover p-0 shadow-md',
                  'transition-[background-color,box-shadow,transform] duration-150 ease-out',
                  'hover:bg-accent hover:shadow-lg active:scale-95',
                  'motion-reduce:transition-none motion-reduce:active:scale-100',
                  hasError ? 'ring-2 ring-destructive/60' : ''
                ].join(' ')}
              >
                <CosmosMark className="size-8" />
                {hasDraft && (
                  // OQ-2 affordance (design §3.3): a preserved-draft dot, decorative.
                  <span
                    aria-hidden="true"
                    className="absolute right-1 top-1 size-2 rounded-full bg-primary ring-2 ring-background"
                  />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Open prompt</TooltipContent>
          </Tooltip>
        </div>

        {/* EXPANDED: centered, constrained-width composer card (FR-010). Opaque
            (bg-popover) so tickets do not bleed through the card itself. */}
        <form
          ref={formRef}
          inert={!expanded}
          aria-hidden={!expanded}
          className={[
            'w-full max-w-2xl rounded-lg border border-input bg-popover p-2 shadow-md',
            // Submit exit is a GROW-TO-FILL-AND-VANISH "launch" (composer-send-animation-v1
            // FR-001, design §3): on submit the card scales UP well past full size while
            // fading + softening to nothing, as if the prompt is launched into the surface —
            // it does NOT shrink back into the logo. A non-submit dismiss (Esc/outside-click)
            // uses a gentle shrink-fade instead, so only a real send reads as the big expand.
            // `transition-[opacity,scale,filter]` MUST name `scale`/`filter` (Tailwind v4:
            // `scale-*` compiles to a standalone `scale:` prop). Both states stay mounted so
            // the exit fires; reduced motion is an instant swap.
            'origin-bottom transition-[opacity,scale,filter] duration-[450ms] ease-[cubic-bezier(0.16,1,0.3,1)]',
            'motion-reduce:transition-none motion-reduce:transform-none',
            expanded
              ? 'pointer-events-auto scale-100 opacity-100 blur-0'
              : launching
                ? 'pointer-events-none scale-[2.6] opacity-0 blur-[2px]'
                : 'pointer-events-none scale-95 opacity-0 blur-[2px]'
          ].join(' ')}
          aria-label={ariaLabel}
          onSubmit={handleSubmit}
        >
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={running}
            tabIndex={expanded ? 0 : -1}
            placeholder={placeholder}
            aria-label={ariaLabel}
            className="max-h-[9rem] min-h-[2.5rem] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[11px] text-muted-foreground">{HINT_COPY}</span>
            {/* FR-009: the in-button "Generating…" glyph is removed — the busy affordance
                is now the surface send-spinner (the composer is off-screen during the run).
                The Send control still DISABLES while a run is in flight (`canSubmit` keys off
                `running`) for the re-open-mid-run case, it just reverts to plain "Send". */}
            <Button
              type="submit"
              variant="cosmos"
              size="sm"
              disabled={!canSubmit}
              tabIndex={expanded ? 0 : -1}
              aria-label="Send"
              className="shrink-0"
            >
              Send
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
