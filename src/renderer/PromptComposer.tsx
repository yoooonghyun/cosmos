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
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import type { AgentStatusPayload } from '../shared/ipc'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { CosmosMark } from './CosmosMark'
import { ContextChip } from './ContextChip'
import type { ContextChipData } from './viewContextCapture'
import {
  submitDecision,
  draftAfterDismiss,
  draftAfterSubmit,
  shouldCollapseOnOutsideClick,
  escDecision,
  sentHintAfterSubmit,
  composerInteractiveAfterSubmit,
  SENT_HINT_DURATION_MS
} from './promptComposerLogic'
import {
  fractionToPx,
  pxToFraction,
  isDrag,
  stepFollow,
  isSettled,
  OPEN_PROMPT_BUTTON_SIZE_PX,
  type PixelPoint,
  type OpenPromptPosition
} from './openPromptPosition'
import { useOpenPromptPosition } from './OpenPromptPositionProvider'

/**
 * Props for the shared composer. Per-panel copy only — no invented props (FR-017 gating
 * stays at the call site; each panel keeps its existing `{isConnected && …}` wrapper).
 */
/**
 * How much of the captured view context the user dismissed for THIS submit
 * (open-prompt-view-context-v1, design §5). `'none'` = attach all; `'thread'` = drop only
 * the Slack thread dimension; `'all'` = attach no context. Per-compose + non-sticky.
 */
export type ContextDismiss = 'none' | 'thread' | 'all'

export interface PromptComposerProps {
  /**
   * Send the raw utterance (the panel hook owns agent.submit + tab bookkeeping). The second
   * arg tells the hook how much view context to attach for this submit (chip dismiss, design
   * §5/§6); omitted ⇒ `'none'` (attach all), so existing callers are unaffected.
   */
  onSubmit: (utterance: string, options?: { contextDismiss: ContextDismiss }) => void
  /** Per-panel textarea placeholder (e.g. "Describe the UI you want…"). */
  placeholder: string
  /** Per-panel accessible name for the form + textarea (e.g. "Ask about your Jira issues"). */
  ariaLabel: string
  /** Accessible name for the collapsed logo button (FR-013). Defaults to "Open prompt". */
  collapsedAriaLabel?: string
  /**
   * Display-only descriptor of the in-view item this prompt will be grounded against
   * (open-prompt-view-context-v1, design §6 Option 1). Undefined ⇒ no chip (design state A).
   * NON-SECRET labels only; the panel derives it from the same state as its `viewContext`.
   */
  contextChip?: ContextChipData
  /**
   * True while THIS panel's active tab has a generation in flight (the same per-tab gate
   * that drives the surface spinner). While busy, the whole composer is hidden — neither the
   * expanded card nor the collapsed logo shows — so the panel is just the spinner; the logo
   * reappears only once generation completes (its surface lands / errors). Default false.
   */
  busy?: boolean
  /**
   * open-prompt-hoist-v1: the element whose content box the floating button positions within
   * (the active surface region). The composer is now ONE App-level instance hoisted OUT of any
   * panel `<section>`, so it can no longer find the panel box via `rootRef.closest('section')`;
   * the App passes the live active-surface element to measure instead. When omitted, it falls
   * back to the legacy `closest('section')` ancestor (per-panel mount), so existing callers /
   * tests are unaffected.
   */
  panelRef?: React.RefObject<HTMLElement | null>
}

/** Shared hint copy under the textarea (design §3.5). */
const HINT_COPY = 'Enter to send · Shift+Enter for newline'

export function PromptComposer({
  onSubmit,
  placeholder,
  ariaLabel,
  collapsedAriaLabel = 'Open prompt',
  contextChip,
  busy = false,
  panelRef
}: PromptComposerProps): React.JSX.Element {
  // Collapsed/expanded is session-only, default collapsed (FR-001/FR-016).
  const [expanded, setExpanded] = useState(false)
  // The draft is preserved across collapse; cleared only on a successful submit (FR-018/OQ-2).
  const [value, setValue] = useState('')
  // open-prompt-spinner-gating ("non-UI submit must not block"): there is NO local `running`
  // flag any more. It used to be set on submit (and by `agent:status` `started`) and stayed
  // true for the WHOLE agent run, locking the reopened composer (textarea/Send disabled, submit
  // rejected) until the run ended — the reported block. A plain submit is fire-and-forget, so
  // the composer stays interactive (see `composerLocked` below). The run lifecycle now feeds
  // ONLY the collapsed-logo error ring via `hasError`.
  // Optional collapsed-logo error ring (design §3.4 / R-1) — cleared on the next run start/complete.
  const [hasError, setHasError] = useState(false)
  // Why the composer is collapsing: a submit "launches" (grow-to-fill + vanish), while an
  // Esc/outside-click "dismisses" (a gentle shrink-fade). Only the launch is the dramatic
  // expand the user asked for; a plain dismiss must not look like a send.
  const [launching, setLaunching] = useState(false)
  // open-prompt-view-context-v1 (design §5): how much of the view context the user dismissed
  // for the NEXT submit via the chip's `×`. Per-compose + non-sticky — reset whenever the
  // composer collapses (close/reopen restores the chip) and after a successful submit.
  const [contextDismiss, setContextDismiss] = useState<'none' | 'thread' | 'all'>('none')
  // open-prompt-spinner-gating-v1 (OQ-3): a transient, non-blocking "Sent" hint shown after
  // an accepted submit now that the "Generating…" blocking spinner is suppressed for a plain
  // command. It NEVER sets `busy` (the composer/logo stay reachable) and auto-dismisses; a
  // true UI-generation run hides it (the surface spinner is the feedback while `busy`).
  const [sentHint, setSentHint] = useState(false)

  // open-prompt-spinner-gating ("non-UI submit must not block"): whether the composer is
  // LOCKED (textarea disabled, Send disabled, submit rejected) — the single gate that replaces
  // the old `running` gating. Constant false (`composerInteractiveAfterSubmit()` ⇒ interactive),
  // so a plain fire-and-forget submit leaves the composer immediately usable for the next send.
  const composerLocked = !composerInteractiveAfterSubmit()

  const logoRef = useRef<HTMLButtonElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)
  // Tracks WHY we collapsed so the focus effect only pulls focus to the logo on an
  // explicit collapse (submit/Esc/outside-click), not on first mount.
  const pendingLogoFocus = useRef(false)

  // draggable-open-prompt-button-v1: the GLOBALLY-SHARED collapsed-logo position
  // (FR-003/FR-004). One value across all panels; a drag here re-renders every mounted
  // PromptComposer. The expanded card stays CENTERED (OQ-4) — only the logo moves.
  const { position, setPosition } = useOpenPromptPosition()
  // The full-panel positioning layer the logo is positioned within. It is sized to the
  // PANEL content box (the nearest `<section>` ancestor), measured into `panelRect`, so the
  // logo's `{xFrac,yFrac}` maps across the WHOLE panel (FR-001/FR-005), not just the bottom
  // strip PromptComposer occupies in the flex column. `slotRef` is the layer element we
  // measure for the fraction↔px convert (FR-006/FR-014).
  const slotRef = useRef<HTMLDivElement | null>(null)
  // PromptComposer's thin root — used only to find the panel `<section>` ancestor.
  const rootRef = useRef<HTMLDivElement | null>(null)
  // The measured panel content rect (viewport coords) the `fixed` layer is sized to. A
  // hidden (inactive, rail-switched-away) panel measures 0 — the logo is hidden there too.
  const [panelRect, setPanelRect] = useState<{ left: number; top: number; width: number; height: number }>(
    { left: 0, top: 0, width: 0, height: 0 }
  )
  // While true, the next `click` on the logo is a DRAG-END, not an open (FR-002). A ref
  // (not state) so the click handler reads the latest value synchronously.
  const draggingRef = useRef(false)
  // Drive a re-render of the logo wrapper while dragging so it follows the pointer live. This
  // is the ANIMATED ("current") position the eased rAF follow writes each frame — NOT the raw
  // cursor — so the button eases toward the cursor with natural accel/decel (motion refinement).
  const [dragPx, setDragPx] = useState<PixelPoint | null>(null)
  // Pointer/start bookkeeping for the active drag gesture.
  const dragStart = useRef<{ pointerId: number; origin: PixelPoint; anchorOffset: PixelPoint } | null>(
    null
  )
  // The eased-follow ("spring") state machine for the drag motion (motion refinement):
  //   - `targetPx`  — where the button WANTS to be (cursor anchor while down; the final clamped
  //                   resting anchor after release), in panel-box-relative px.
  //   - `currentPx` — the ANIMATED position the rAF loop eases toward `targetPx` each frame.
  //   - `rafId`     — the live rAF handle (null ⇒ loop idle), cancelled on settle/unmount.
  //   - `lastTs`    — previous frame timestamp for a framerate-independent `dt`.
  //   - `releasing` — true after pointerup: once the follow settles, commit the final fraction
  //                   ONCE and stop. `pendingCommit` is that final clamped fraction.
  const followRef = useRef<{
    targetPx: PixelPoint
    currentPx: PixelPoint
    rafId: number | null
    lastTs: number | null
    releasing: boolean
    pendingCommit: OpenPromptPosition | null
  }>({
    targetPx: { x: 0, y: 0 },
    currentPx: { x: 0, y: 0 },
    rafId: null,
    lastTs: null,
    releasing: false,
    pendingCommit: null
  })

  // Whether the user prefers reduced motion. When true the eased follow is bypassed entirely:
  // the button jumps straight to the target (no spring), matching the existing motion-reduce
  // CSS fallback. Read live via matchMedia so a runtime OS change is respected.
  const prefersReducedMotion = useRef(false)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    prefersReducedMotion.current = mq.matches
    const onChange = (e: MediaQueryListEvent): void => {
      prefersReducedMotion.current = e.matches
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // The single rAF tick: ease `currentPx` toward `targetPx` framerate-independently, paint it,
  // and stop when settled. While the pointer is down the loop keeps running (each move updates
  // `targetPx`); after release it runs until the spring settles, then commits the final fraction.
  const tickFollow = useCallback(
    (ts: number): void => {
      const f = followRef.current
      const dt = f.lastTs == null ? 16 : ts - f.lastTs
      f.lastTs = ts
      f.currentPx = stepFollow(f.currentPx, f.targetPx, dt)
      const settled = isSettled(f.currentPx, f.targetPx)
      if (settled) {
        f.currentPx = { ...f.targetPx } // snap to exact target (no sub-pixel asymptote churn)
      }
      setDragPx({ ...f.currentPx })
      if (settled && f.releasing) {
        // Release fully settled: commit the final clamped fraction ONCE, then idle the loop and
        // hand the render back to `restingPx`. The `dragging` flag re-enables the CSS path.
        if (f.pendingCommit) {
          setPosition(f.pendingCommit)
          f.pendingCommit = null
        }
        f.releasing = false
        f.rafId = null
        f.lastTs = null
        setDragPx(null)
        return
      }
      f.rafId = requestAnimationFrame(tickFollow)
    },
    [setPosition]
  )

  // Start the rAF follow if it isn't already running (idempotent — pointermove calls this every
  // event but only the first arms the loop; the rest just refresh `targetPx`).
  const ensureFollowRunning = useCallback((): void => {
    const f = followRef.current
    if (f.rafId == null) {
      f.lastTs = null
      f.rafId = requestAnimationFrame(tickFollow)
    }
  }, [tickFollow])

  // Cancel any in-flight follow loop on unmount (no leak / no setState-after-unmount).
  useEffect(() => {
    return () => {
      const f = followRef.current
      if (f.rafId != null) {
        cancelAnimationFrame(f.rafId)
        f.rafId = null
      }
    }
  }, [])

  // Measure the FULL panel box (the `inset-0` positioning layer); falls back to a 0-box
  // pre-layout (the size-aware px clamp pins the anchor at 0). The logo's `{xFrac,yFrac}`
  // now maps across the WHOLE panel content area (top/middle/corners/sides), not just the
  // bottom strip — the layer spans `inset-0`.
  const slotBox = useCallback((): { width: number; height: number; left: number; top: number } => {
    const rect = slotRef.current?.getBoundingClientRect()
    return rect
      ? { width: rect.width, height: rect.height, left: rect.left, top: rect.top }
      : { width: 0, height: 0, left: 0, top: 0 }
  }, [])

  const onLogoPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>): void => {
      // Only the primary button starts a drag; ignore while expanded/busy (logo is inert).
      if (event.button !== 0 || expanded || busy) {
        return
      }
      const box = slotBox()
      const f = followRef.current
      // Re-grab during a release-SETTLE: the committed `position` fraction is STALE (it commits
      // only once the spring settles), so seeding from it would snap the button back to its
      // previous resting spot. While a settle is mid-flight (`rafId` live or a `dragPx` painted),
      // grab from the LIVE animated position (`f.currentPx`) so the new drag continues from where
      // the button visibly is. Otherwise (at rest) seed from the committed fraction.
      const settleInFlight = f.rafId != null || dragPx != null
      const anchor = settleInFlight ? { ...f.currentPx } : fractionToPx(position, box, OPEN_PROMPT_BUTTON_SIZE_PX)
      // The grab offset within the button so the cursor stays on the same spot mid-drag.
      const pointer: PixelPoint = { x: event.clientX - box.left, y: event.clientY - box.top }
      dragStart.current = {
        pointerId: event.pointerId,
        origin: pointer,
        anchorOffset: { x: pointer.x - anchor.x, y: pointer.y - anchor.y }
      }
      draggingRef.current = false
      // Cancel any leftover settle loop, then seed the eased-follow state machine from the anchor
      // (the live position when re-grabbing mid-settle) so the spring eases OUT from where the
      // button already sits (no pop / no jump-back).
      if (f.rafId != null) {
        cancelAnimationFrame(f.rafId)
        f.rafId = null
      }
      f.currentPx = { ...anchor }
      f.targetPx = { ...anchor }
      f.lastTs = null
      f.releasing = false
      f.pendingCommit = null
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [expanded, busy, position, slotBox, dragPx]
  )

  const onLogoPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>): void => {
      const start = dragStart.current
      if (!start || start.pointerId !== event.pointerId) {
        return
      }
      const box = slotBox()
      const pointer: PixelPoint = { x: event.clientX - box.left, y: event.clientY - box.top }
      // Past the threshold this becomes a drag (suppresses the click-to-open — FR-002).
      if (!draggingRef.current && isDrag(start.origin, pointer)) {
        draggingRef.current = true
      }
      if (draggingRef.current) {
        // The cursor TARGET: button top-left at pointer minus the grab offset, clamped fully
        // in-bounds (FR-005) via the size-aware fraction round-trip.
        const rawAnchor = { x: pointer.x - start.anchorOffset.x, y: pointer.y - start.anchorOffset.y }
        const clampedFrac = pxToFraction(rawAnchor, box, OPEN_PROMPT_BUTTON_SIZE_PX)
        const target = fractionToPx(clampedFrac, box, OPEN_PROMPT_BUTTON_SIZE_PX)
        const f = followRef.current
        f.targetPx = target
        if (prefersReducedMotion.current) {
          // Reduced motion: no spring — jump straight to the cursor (instant 1:1), no rAF loop.
          f.currentPx = { ...target }
          setDragPx({ ...target })
        } else {
          // Update the spring target and (idempotently) arm the eased follow loop so the button
          // accelerates toward / decelerates into the cursor instead of snapping.
          ensureFollowRunning()
        }
      }
    },
    [slotBox, ensureFollowRunning]
  )

  const onLogoPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>): void => {
      const start = dragStart.current
      if (!start || start.pointerId !== event.pointerId) {
        return
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      if (draggingRef.current) {
        // The final clamped fraction (release outside → nearest in-bounds spot, FR-005). The
        // `click` that follows is swallowed by `onClick`.
        const box = slotBox()
        const pointer: PixelPoint = { x: event.clientX - box.left, y: event.clientY - box.top }
        const rawAnchor = { x: pointer.x - start.anchorOffset.x, y: pointer.y - start.anchorOffset.y }
        const finalFrac = pxToFraction(rawAnchor, box, OPEN_PROMPT_BUTTON_SIZE_PX)
        const finalPx = fractionToPx(finalFrac, box, OPEN_PROMPT_BUTTON_SIZE_PX)
        const f = followRef.current
        if (prefersReducedMotion.current) {
          // Reduced motion: commit immediately, no settle animation.
          setPosition(finalFrac)
          if (f.rafId != null) {
            cancelAnimationFrame(f.rafId)
            f.rafId = null
          }
          f.releasing = false
          f.pendingCommit = null
          setDragPx(null)
        } else {
          // Let the spring DECELERATE into the final resting anchor, then commit the fraction
          // ONCE on settle (handled in tickFollow). Keep `dragging` true until then so the rAF
          // transform isn't fought by the CSS transition mid-settle.
          f.targetPx = finalPx
          f.pendingCommit = finalFrac
          f.releasing = true
          ensureFollowRunning()
        }
      } else {
        // Sub-threshold press (a click): no drag animation was armed — nothing to settle.
        setDragPx(null)
      }
      dragStart.current = null
      // `draggingRef` stays true until the click fires so onClick can suppress the open;
      // it is reset at the end of the click handler (or here if no click follows).
    },
    [slotBox, setPosition, ensureFollowRunning]
  )

  // The logo's RESTING pixel anchor, derived from the shared fraction against the measured
  // PANEL box. Re-measured on the shared `position` change AND on panel resize/scroll (a
  // ResizeObserver on the panel section + window resize/scroll) so a persisted position
  // that lands off-screen at a smaller size clamps back into view before paint
  // (FR-012/SC-007 — `fractionToPx` is size-aware). The `fixed` layer is also kept aligned
  // to the live panel rect via `panelRect`. While a drag is active, `dragPx` overrides the
  // resting anchor for live following.
  const [restingPx, setRestingPx] = useState<PixelPoint>({ x: 0, y: 0 })
  useLayoutEffect(() => {
    // The panel content box. open-prompt-hoist-v1: the single hoisted composer is given the
    // live ACTIVE-surface element via `panelRef` (it lives outside any panel `<section>` now),
    // so measure that when provided; otherwise fall back to the nearest `<section>` ancestor
    // (legacy per-panel mount — every panel is a `<section className="flex h-full flex-col">`).
    // The logo positions across THIS box, so it is droppable anywhere — top/middle/corners/sides.
    const panelEl: Element | null = panelRef?.current ?? rootRef.current?.closest('section') ?? null
    const measure = (): void => {
      const rect = panelEl?.getBoundingClientRect()
      const box = rect
        ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
        : { left: 0, top: 0, width: 0, height: 0 }
      setPanelRect(box)
      setRestingPx(fractionToPx(position, box, OPEN_PROMPT_BUTTON_SIZE_PX))
    }
    measure()
    if (!panelEl || typeof ResizeObserver === 'undefined') {
      return
    }
    const ro = new ResizeObserver(measure)
    ro.observe(panelEl)
    // The fixed layer is in viewport coords, so a window resize/scroll moves the panel box.
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
    // `panelRef` is a stable ref object (its identity never changes); it is listed so the
    // effect re-binds if a caller ever swaps the ref. The single hoisted composer measures a
    // STABLE surface-region element (constant across panel switches), so no per-switch re-run
    // is needed — a size change (rail show/hide) is caught by the ResizeObserver above.
  }, [position, panelRef])

  // What the logo wrapper is positioned at this render (panel-box-relative px): the live
  // drag px while dragging, else the resting (clamped) anchor from the shared fraction.
  const logoPx = dragPx ?? restingPx

  // Keep the run-status subscription (OQ-1): it now drives the collapsed-logo error ring ONLY
  // (`hasError`). open-prompt-spinner-gating ("non-UI submit must not block"): `running` no
  // longer gates interactivity — the composer stays typeable/sendable for the run's duration —
  // so this subscription's job is reduced to lighting the error ring on a failed run.
  useEffect(() => {
    const off = window.cosmos.agent.onStatus((status: AgentStatusPayload) => {
      switch (status.state) {
        case 'started':
          setHasError(false)
          break
        case 'completed':
          setHasError(false)
          break
        case 'error':
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
    // Chip dismiss is per-compose (design §5): collapsing (submit/Esc/outside-click) resets
    // it so re-opening restores the full chip.
    setContextDismiss('none')
  }, [])

  // FR-005/FR-006: send only on a non-empty, non-running submit, then auto-collapse +
  // clear the draft + return focus to the logo. Keys off the composer's OWN accept
  // decision (not an agent:status event), so collapse is immediate and deterministic.
  const submit = useCallback((): void => {
    // open-prompt-spinner-gating ("non-UI submit must not block"): the accept decision keys
    // off `composerLocked`, NOT the agent run. A plain submit is fire-and-forget, so the run
    // being in flight must NOT reject the next send — `composerLocked` is constant false (the
    // composer stays interactive), matching the textarea/Send gating below.
    const { accept } = submitDecision({ value, running: composerLocked })
    if (!accept) {
      return
    }
    onSubmit(value, { contextDismiss }) // attach the chip-dismiss choice for this submit
    // Do NOT set `running` here: a plain submit must not lock the composer for the whole run
    // (the prior bug). `running` is now driven SOLELY by `agent:status` to light the error
    // ring; it never gates typing/sending. If this run generates a surface it still lands and
    // renders in the surface area (via `ui:render`) without ever blocking the composer.
    setHasError(false)
    setValue(draftAfterSubmit()) // clear only on success (FR-005)
    setLaunching(true) // submit collapse = grow-to-fill + vanish (the "launch")
    // open-prompt-spinner-gating-v1 (OQ-3): acknowledge the accepted submit with the transient
    // "Sent" hint. Non-blocking — if this run turns out to generate a surface, `busy` engages
    // and the render below hides the hint in favour of the surface spinner.
    setSentHint(sentHintAfterSubmit(true).visible)
    collapse(true) // auto-collapse to the logo (FR-006/FR-012)
  }, [value, composerLocked, onSubmit, contextDismiss, collapse])

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

  // open-prompt-spinner-gating-v1 (OQ-3): auto-dismiss the transient "Sent" hint. The pure
  // when/duration decision lives in promptComposerLogic; only the timer binding is here.
  useEffect(() => {
    if (!sentHint) {
      return
    }
    const id = window.setTimeout(() => setSentHint(false), SENT_HINT_DURATION_MS)
    return () => window.clearTimeout(id)
  }, [sentHint])

  // open-prompt-spinner-gating ("non-UI submit must not block"): Send is enabled whenever there
  // is text and the composer is not locked. It keys off `composerLocked` (constant false), NOT
  // the agent run, so a reopened composer can send again immediately mid-run.
  const canSubmit = !composerLocked && value.trim().length > 0
  const hasDraft = value.trim().length > 0
  // The "Sent" hint shows only while NOT busy: a UI-generation run engages `busy` (the surface
  // spinner is the feedback), so the hint is for plain commands only and never co-shows.
  const showSentHint = sentHint && !busy

  // BOTH states are ALWAYS mounted so the open/close CSS transition fires in both
  // directions (FR-004): conditional mount/unmount would skip enter/exit animation.
  // They share one zero-height in-flow overlay slot anchored just above the footer, so
  // the expanded composer floats over the content (tickets stay full-height behind it)
  // and the collapsed logo has NO in-flow band of its own. `expanded` cross-fades /
  // morphs between them; the hidden one is `inert` + non-interactive so focus and clicks
  // only ever reach the visible state (FR-002/SC-007). The surround is transparent +
  // pointer-events-none so clicks pass through to the content behind.
  return (
    <div ref={rootRef} className="relative shrink-0">
      {/* draggable-open-prompt-button-v1 (FR-001/FR-005): the FULL-PANEL positioning layer
          for the draggable collapsed logo. It is `position: fixed` and SIZED to the live
          panel content rect (`panelRect`, the nearest `<section>`), so it covers the WHOLE
          panel — not just the bottom strip PromptComposer occupies in the flex column —
          while staying clipped to this panel (a hidden panel measures 0). It is
          `pointer-events-none` so the panel content behind stays clickable, re-enabling
          pointer events ONLY on the button. The logo's `{xFrac,yFrac}` maps across this
          entire box, so it is droppable anywhere — top, middle, corners, sides. */}
      <div
        ref={slotRef}
        style={{
          left: `${panelRect.left}px`,
          top: `${panelRect.top}px`,
          width: `${panelRect.width}px`,
          height: `${panelRect.height}px`
        }}
        className="pointer-events-none fixed"
      >
        {/* COLLAPSED: the draggable cosmos-logo button. Positioned by a TRANSFORM
            (`translate3d`) — NOT `left/top` — so dragging animates the compositor, not
            layout (no per-frame layout thrash). During a drag a requestAnimationFrame SPRING
            (exponential ease, `stepFollow`) eases the transform toward the cursor with natural
            accel/decel, so the CSS transform transition is OFF then (the spring IS the easing).
            It is ON otherwise for the initial/no-JS paint; reduced motion bypasses the spring
            (instant jump) via `prefers-reduced-motion`. */}
        <div
          inert={expanded || busy}
          aria-hidden={expanded || busy}
          style={{ transform: `translate3d(${logoPx.x}px, ${logoPx.y}px, 0)` }}
          className={[
            // Anchor at the layer's top-left; the transform carries it to the px anchor.
            'absolute left-0 top-0 will-change-transform',
            // Motion refinement: while a drag/settle is active the rAF spring owns the
            // transform (eased accel/decel follow), so DISABLE the CSS transform transition then
            // — a transition on top would double-lag and fight the spring. Otherwise transition
            // the transform (initial paint / reduced-motion fallback). Opacity always transitions
            // so the logo still fades on expand/busy.
            // Transform is owned by the rAF spring DURING a drag and is INSTANT for resting
            // changes (panel switch / resize / first measure) — NEVER CSS-transitioned, so the
            // logo never animates in ("drops") from a stale top-left 0-box anchor. Opacity always
            // transitions so the logo still fades on expand/busy and fades in once placed.
            'transition-opacity duration-[400ms] ease-[cubic-bezier(0.16,1,0.3,1)]',
            'motion-reduce:transition-none',
            // Keep the logo invisible until the panel box is actually measured (width>0). A
            // rail-switched / not-yet-laid-out panel measures a 0-box, whose resting anchor is the
            // top-left corner; hiding it until measured means it just FADES IN at the correct spot
            // instead of appearing at top-left and sliding into place.
            expanded || busy || panelRect.width === 0
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
                onPointerDown={onLogoPointerDown}
                onPointerMove={onLogoPointerMove}
                onPointerUp={onLogoPointerUp}
                onClick={() => {
                  // draggable-open-prompt-button-v1 (FR-002): a drag-end fires a click too;
                  // swallow it so a drag never ALSO opens the composer. A sub-threshold
                  // press leaves `draggingRef` false ⇒ the click opens as before.
                  if (draggingRef.current) {
                    draggingRef.current = false
                    return
                  }
                  setLaunching(false)
                  setExpanded(true)
                }}
                className={[
                  'relative size-12 rounded-xl border border-border bg-popover p-0 shadow-md',
                  // draggable affordance (OQ-3 whole-button drag): grab cursor at rest,
                  // grabbing while a drag is active; touch-none so the pointer drag is not
                  // hijacked by scroll/gesture handling.
                  'cursor-grab touch-none active:cursor-grabbing',
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
      </div>

      {/* The EXPANDED card + the "Sent" hint keep their own bottom-anchored overlay slot —
          the expanded composer stays CENTERED-bottom (OQ-4), independent of the logo. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex min-h-[4.5rem] items-end justify-center px-3 pb-3 pt-2">
        {/* open-prompt-spinner-gating-v1 (OQ-3): the transient, non-blocking "Sent" hint for a
            plain command. Decorative + pointer-events-none (it never blocks the logo beneath),
            reusing the existing muted-foreground token (same as the composer hint copy). Sits
            just above the collapsed logo and fades out on auto-dismiss. */}
        <span
          aria-hidden="true"
          className={[
            'pointer-events-none absolute bottom-[3.75rem] left-1/2 -translate-x-1/2',
            'text-[11px] text-muted-foreground',
            'transition-opacity duration-200 ease-out motion-reduce:transition-none',
            showSentHint ? 'opacity-100' : 'opacity-0'
          ].join(' ')}
        >
          Sent
        </span>

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
            // open-prompt-spinner-gating: typeable whenever the composer is not locked
            // (constant false) — never disabled merely because an agent run is in flight.
            disabled={composerLocked}
            tabIndex={expanded ? 0 : -1}
            placeholder={placeholder}
            aria-label={ariaLabel}
            className="max-h-[9rem] min-h-[2.5rem] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          {/* open-prompt-view-context-v1 (design §3/§5): the in-view context chip, between the
              textarea and the footer. Hidden entirely once dismissed 'all'; the thread badge is
              dropped once dismissed 'thread'. Reflects what "this ticket/channel/…" resolves to. */}
          {contextDismiss !== 'all' && (
            <ContextChip
              data={
                contextChip && contextDismiss === 'thread'
                  ? { primary: contextChip.primary }
                  : contextChip
              }
              // Mirror the Send button (design §3): the remove `×` follows `composerLocked`,
              // NOT the agent run, so the chip stays editable while composing the next prompt.
              running={composerLocked}
              onRemoveAll={() => setContextDismiss('all')}
              onRemoveThread={() => setContextDismiss('thread')}
            />
          )}
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
