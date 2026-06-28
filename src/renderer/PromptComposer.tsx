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
  isAlwaysOpen,
  SENT_HINT_DURATION_MS
} from './promptComposerLogic'
import {
  fractionToPx,
  pxToFraction,
  isDrag,
  stepFollow,
  isSettled,
  clampCardWithinPanel,
  resolveLiveAnchor,
  resolveOpenAnchor,
  OPEN_PROMPT_BUTTON_SIZE_PX,
  type PixelPoint,
  type OpenPromptPosition,
  type CardSize
} from './openPromptPosition'
import { useOpenPromptPosition } from './OpenPromptPositionProvider'
import { useGlassDockFilter, ALL_EDGES } from './glassDock/useGlassDockFilter'
import { OPEN_PROMPT_GLASS_CONFIG } from './glassDock/config'

// open-prompt-glass: corner radius (px) of the expanded composer card. It wears `rounded-lg`
// = `--radius` (0.5rem ≈ 8px), so the all-edges bezel refraction must sweep an 8px rounded rim.
const CARD_RADIUS_PX = 8
// The collapsed logo is `size-12` (48px). It reads as a glass PEBBLE: a circular fill+blur
// (rounded-full) with NO displacement map — a refraction bezel on a ~40px element is degenerate
// (the rounded path is reserved for the larger card), so the pebble gets just the frosted fill.

// open-prompt-glass: the float shadow for the Open Prompt surfaces. `glass-dock`'s own box-shadow
// is tuned for a LEFT-edge drawer (one-sided rim highlight + leftward drop) which looks wrong on a
// centered floating pill/card, so these surfaces override it inline with the same lit inset rim
// (top highlight + edge) plus an EVEN, all-around ambient drop shadow. Uses the mode-aware
// `--glass-dock-*` tokens so the rim still matches the docks across light/dark.
const OPEN_PROMPT_GLASS_SHADOW =
  'inset 0 1px 0 0 var(--glass-dock-highlight), ' +
  'inset 0 0 0 1px var(--glass-dock-edge), ' +
  '0 8px 30px -8px rgb(0 0 0 / 0.45)'

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
  /**
   * cosmos-open-prompt-pinned-v1 (OQ-1 Option A): the per-surface render mode.
   *  - `'floating'` (DEFAULT) — today's draggable, collapse-on-exit logo overlay; existing
   *    callers/tests are unaffected because the default preserves the current behavior.
   *  - `'docked'` — the Cosmos always-open, bottom-pinned chat input: forced expanded, never
   *    collapses on submit/Esc/outside-click, not hidden by `busy`, no drag/logo/scrim/glass
   *    layer. `SharedComposer` passes this only for the Cosmos surface (via
   *    `composerModeForSurface`); the docked WRAPPER (the `shrink-0 border-t` band) lives in
   *    `SharedComposer`, this prop only switches the composer body.
   */
  mode?: 'docked' | 'floating'
  /**
   * cosmos-open-prompt-pinned-v1 (OQ-2): true while the Cosmos panel is the ACTIVE surface.
   * Drives auto-focus of the docked textarea on the activation EDGE (becomes-active), so the
   * user can type immediately without stealing focus from the Terminal / another panel. Only
   * meaningful in `'docked'` mode; ignored when floating. Default false.
   */
  autoFocusActive?: boolean
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
  panelRef,
  mode = 'floating',
  autoFocusActive = false
}: PromptComposerProps): React.JSX.Element {
  // cosmos-open-prompt-pinned-v1 (OQ-1 Option A): the docked Cosmos chat input vs the floating
  // collapsible logo. The `.tsx` reads ONLY these booleans (the pure decisions live in
  // promptComposerLogic). `docked` ⇒ always-open, never collapses, not hidden by busy.
  const docked = isAlwaysOpen(mode)
  // Collapsed/expanded is session-only, default collapsed (FR-001/FR-016). In docked mode the
  // composer is FORCED expanded — `expanded` (the floating state) is irrelevant; `isOpen` is
  // the value every render branch reads so docked is permanently open (cosmos-..-pinned FR-001).
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

  // open-prompt-open-at-position-v1 (FR-009): the expanded card's REAL measured rendered size,
  // fed into `clampCardWithinPanel` so the clamp uses the actual box (not a hard-coded constant).
  // `null` until the `<form>` is first measured — while null the card is kept invisible
  // (hide-until-measured, like the logo's `panelRect.width === 0` gate) so it never flashes at
  // the wrong spot before the size is known. Re-measured on content change via a ResizeObserver.
  const [cardSize, setCardSize] = useState<CardSize | null>(null)

  // open-prompt-open-at-position-v1 (OQ-1 FREEZE + mid-settle open fix): the button anchor
  // FROZEN at open-time, used to position the expanded card. Captured the moment the composer
  // opens (collapsed→expanded) — from the LIVE animated position when opening mid-settle (the
  // committed fraction is still gliding to its end target then), else the resting anchor — so
  // the card opens where the logo VISUALLY is at click, not where it started or will end up.
  // `null` while collapsed; the card reads `logoPx` (live) only as a fallback before capture.
  const [openAnchor, setOpenAnchor] = useState<PixelPoint | null>(null)

  // open-prompt-spinner-gating ("non-UI submit must not block"): whether the composer is
  // LOCKED (textarea disabled, Send disabled, submit rejected) — the single gate that replaces
  // the old `running` gating. Constant false (`composerInteractiveAfterSubmit()` ⇒ interactive),
  // so a plain fire-and-forget submit leaves the composer immediately usable for the next send.
  const composerLocked = !composerInteractiveAfterSubmit()

  // open-prompt-glass: the expanded card's per-instance liquid-glass refraction filter. It reuses
  // the docks' glass infrastructure (`useGlassDockFilter`) but with the rounded-surface knobs
  // (`OPEN_PROMPT_GLASS_CONFIG`) and ALL FOUR edges + the card's real corner radius, so the bezel
  // refraction sweeps the full rounded rim instead of a single flush edge. The hook measures the
  // element it's `ref`'d to (the form) and regenerates the map on resize; `cardGlass.style` sets
  // the `backdrop-filter`, `cardGlass.filter` is the injected `<svg><filter>`. The card also wears
  // the shared `glass-dock` CSS class for the fill/edge/highlight layers. NOTE: the form's measured
  // LAYOUT box (offsetWidth/offsetHeight, read by the open-at-position clamp) is unaffected by the
  // backdrop-filter, and the glass `ref` is a separate callback ref from `formRef` — both attach to
  // the same form without conflict — so the drag/anchor math is untouched (material swap only).
  const cardGlass = useGlassDockFilter({
    edges: ALL_EDGES,
    config: OPEN_PROMPT_GLASS_CONFIG,
    radius: CARD_RADIUS_PX
  })

  // open-prompt-glass: the collapsed logo is a small (~48px) round pebble. A per-instance
  // displacement bezel on an element that tiny reads degenerate (the whole pebble would be rim),
  // so by design it gets just the GLASS FILL + frosted blur (the `glass-dock` class + this plain
  // backdrop blur/saturate) — no refraction map — reserving the full bezel refraction for the
  // larger card. The blur/saturate come from the SAME shared config so the pebble and card frost
  // match. Static (no measurement needed), so an inline style, not the hook.
  const logoGlassStyle = {
    backdropFilter: `blur(${OPEN_PROMPT_GLASS_CONFIG.blur}px) saturate(${OPEN_PROMPT_GLASS_CONFIG.saturate})`,
    WebkitBackdropFilter: `blur(${OPEN_PROMPT_GLASS_CONFIG.blur}px) saturate(${OPEN_PROMPT_GLASS_CONFIG.saturate})`,
    // `glass-dock`'s own box-shadow is the LEFT-only drawer rim + a leftward depth shadow — wrong
    // for a CENTERED floating surface. Override (inline wins over the @utility) with the same
    // inset edge highlight but a SYMMETRIC, all-around drop shadow so the pebble/card float evenly.
    boxShadow: OPEN_PROMPT_GLASS_SHADOW
  } as React.CSSProperties

  // open-prompt-glass: shared box-shadow for the centered floating surfaces (logo + card). Keeps
  // `glass-dock`'s lit inset rim (top highlight + left edge) but swaps its one-sided drawer drop
  // shadow for an even ambient one. `--glass-dock-*` tokens are mode-aware (light/dark) so the rim
  // matches the docks.
  const cardGlassStyle = { ...cardGlass.style, boxShadow: OPEN_PROMPT_GLASS_SHADOW }

  const logoRef = useRef<HTMLButtonElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)

  // open-prompt-open-at-position-v1 (FR-009): measure the form's REAL layout box into `cardSize`.
  // Hoisted to a stable callback so BOTH the merged ref (on attach) and the content-change
  // ResizeObserver effect below call the SAME measure. `offsetWidth/Height` is the un-transformed
  // layout box (stable across the open/close scale morph; the backdrop-filter does not affect it).
  const measureCard = useCallback((el: HTMLFormElement): void => {
    setCardSize((prev) => {
      const next = { width: el.offsetWidth, height: el.offsetHeight }
      if (prev && prev.width === next.width && prev.height === next.height) {
        return prev // skip the state churn (and re-render) when the box is unchanged
      }
      return next
    })
  }, [])

  // The form needs TWO refs: `formRef` (positioning/measure) and the glass hook's measuring ref.
  // Merge them in one callback so a single `ref` prop drives both.
  //
  // open-prompt-glass centering fix: the `cardSize` measurement MUST happen here, when the element
  // actually attaches, NOT only inside a `useLayoutEffect` keyed on `[contextChip, contextDismiss]`.
  // The glass hook's `ref` synchronously runs `regenerate()` → `setState`, so the layout-effect path
  // alone could leave `cardSize` at its initial `null`/0 (the effect doesn't re-run on the glass
  // re-render), which made `clampCardWithinPanel` skip the `-cardW/2,-cardH/2` centering offset and
  // open the card at the button's TOP-LEFT instead of CENTERED. Measuring on attach guarantees
  // `cardSize` is the real `max-w-2xl` box the moment the form exists.
  const setFormRef = useCallback(
    (el: HTMLFormElement | null): void => {
      formRef.current = el
      cardGlass.ref(el)
      if (el) {
        measureCard(el)
      }
    },
    // Depend on the STABLE `cardGlass.ref` callback, NOT the whole `cardGlass` result object —
    // the hook returns a new object every render, so `[cardGlass]` made `setFormRef` change
    // identity each render, React re-attached the ref every render, and the ref's synchronous
    // `regenerate()` setState looped infinitely ("Maximum update depth exceeded").
    [cardGlass.ref, measureCard]
  )
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
  // open-prompt-open-at-position-v1 (mid-settle open fix): the LIVE button anchor captured the
  // instant a pointerdown INTERRUPTED an in-flight settle. The click that follows (pointerdown→
  // up→click with no move past threshold) reads this SYNCHRONOUSLY in `openComposer`, so the card
  // anchors at the logo's live glide position regardless of whether the `dragPx`/`restingPx`
  // re-render has flushed yet. A ref (not state) — set in `onLogoPointerDown`, consumed + cleared
  // in `openComposer`; null on a plain at-rest click (no settle was interrupted).
  const pendingOpenAnchorRef = useRef<PixelPoint | null>(null)
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
      const anchor = resolveLiveAnchor(
        settleInFlight,
        f.currentPx,
        fractionToPx(position, box, OPEN_PROMPT_BUTTON_SIZE_PX)
      )
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
      // open-prompt-open-at-position-v1 (mid-settle open fix): if this pointerdown INTERRUPTED an
      // in-flight settle, COMMIT the live grab point to the shared fraction NOW. The interrupted
      // settle would otherwise never commit (it commits only on natural settle), leaving `position`
      // / `restingPx` stale at the OLD end-target. A plain click (pointerdown→up→click with no move)
      // then opens via `openComposer`, which by that time sees `settleInFlight === false` (the rAF
      // is cancelled here and `dragPx` is cleared on pointerup) and would resolve the STALE resting
      // anchor — opening the card at the pre-move position (the reported bug). Committing here makes
      // `restingPx` reflect the live grab point, so the subsequent open anchors correctly even
      // though the drag turned out to be a click.
      if (settleInFlight) {
        setPosition(pxToFraction(anchor, box, OPEN_PROMPT_BUTTON_SIZE_PX))
        // Stash the live grab point so a click-to-open on THIS gesture anchors the card here
        // (the `restingPx` re-render from the commit above may not have flushed by the click).
        pendingOpenAnchorRef.current = { ...anchor }
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [expanded, busy, position, slotBox, dragPx, setPosition]
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
        // This gesture is a real DRAG, not a click-to-open — drop any stashed open anchor so a
        // later legitimate open does not reuse this drag's grab point.
        pendingOpenAnchorRef.current = null
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

  // open-prompt-open-at-position-v1 (OQ-1 FREEZE + mid-settle open fix): open the composer,
  // FREEZING the logo (and the card's anchor) at the button's LIVE position this instant.
  //
  // THE EVENT SEQUENCE (why a naive read is stale). A click is pointerdown→pointerup→click.
  // When the user clicks the logo WHILE it is gliding mid-settle, `onLogoPointerDown` runs FIRST:
  // it cancels the settle rAF (`f.rafId = null`) and stashes the live grab point in
  // `pendingOpenAnchorRef`; `onLogoPointerUp` then clears `dragPx` (it was a click, no move). So
  // by the time THIS `onClick` handler runs, `f.rafId == null` AND `dragPx == null` — the
  // `settleInFlight` heuristic is already FALSE and `restingPx` may still hold the OLD end-target
  // (the commit from pointerdown may not have re-rendered yet). Reading `restingPx` here opened
  // the card at the PRE-MOVE position (the reported bug).
  //
  // FIX: prefer the synchronously-stashed `pendingOpenAnchorRef` (the live grab point captured in
  // pointerdown) — it is ref state, immune to render timing — falling back to the settle/resting
  // resolution only for a true at-rest click (no gesture interrupted a settle). The live source is
  // `f.currentPx`, the SAME value painted into the logo's `translate3d`, so card and logo agree.
  const openComposer = useCallback((): void => {
    const f = followRef.current
    const stashed = pendingOpenAnchorRef.current
    const settleInFlight = f.rafId != null || dragPx != null
    // Live anchor: the gesture-stashed grab point if a settle was just interrupted by this click's
    // pointerdown; else the in-flight animated px; else the resting anchor (true at-rest open).
    const live = resolveOpenAnchor(stashed, settleInFlight, f.currentPx, restingPx)
    if (stashed || settleInFlight) {
      // Stop any still-running settle so the logo does not keep easing to its old end target after
      // the card opens (else the inert logo + frozen card would disagree / drift).
      if (f.rafId != null) {
        cancelAnimationFrame(f.rafId)
        f.rafId = null
      }
      f.releasing = false
      f.pendingCommit = null
      f.lastTs = null
      f.currentPx = { ...live }
      f.targetPx = { ...live }
      // Freeze the shared fraction at the live point so `restingPx` agrees once `dragPx` clears.
      setPosition(pxToFraction(live, slotBox(), OPEN_PROMPT_BUTTON_SIZE_PX))
      setDragPx(null)
    }
    pendingOpenAnchorRef.current = null
    setOpenAnchor(live)
    setLaunching(false)
    setExpanded(true)
  }, [dragPx, restingPx, setPosition, slotBox])

  // open-prompt-open-at-position-v1 (FR-009): measure the expanded card's real rendered size
  // (the `<form>` box) so the clamp below uses the actual width/height of the `max-w-2xl` card,
  // not a hard-coded constant. A ResizeObserver re-measures when the content height changes
  // (chip shown/hidden, textarea grows). The form is ALWAYS mounted (both states render), so the
  // ref is available even while collapsed; we measure its natural box (it is only scaled by the
  // CSS transform, which a `getBoundingClientRect` would include — so we read `offsetWidth/Height`,
  // the un-transformed layout box, to keep the clamp stable across the open/close scale morph).
  useLayoutEffect(() => {
    const el = formRef.current
    if (!el) {
      return
    }
    measureCard(el)
    if (typeof ResizeObserver === 'undefined') {
      return
    }
    const ro = new ResizeObserver(() => measureCard(el))
    ro.observe(el)
    return () => ro.disconnect()
    // Re-measure when content that changes the card height toggles: the context chip's presence
    // and the dismiss state both alter the rendered height. (The first attach-time measurement is
    // done in `setFormRef`/`measureCard`; this effect handles content-driven size changes.)
  }, [contextChip, contextDismiss, measureCard])

  // open-prompt-open-at-position-v1 (FR-001/FR-002/FR-007): the expanded card's clamped top-left
  // in the SAME panel-box px frame as the logo. Anchored bottom-LEFT at the live button anchor
  // (`logoPx`, frozen at open since the logo is `inert` while expanded — OQ-1 FREEZE), grown UP,
  // then clamped so the full card box stays inside `panelRect`. Falls back to a 0-box until the
  // card is measured; the render keeps the card invisible until `cardSize` exists so the
  // pre-measure frame never flashes off-anchor (hide-until-measured, FR-009).
  const cardPx = clampCardWithinPanel(
    openAnchor ?? logoPx,
    OPEN_PROMPT_BUTTON_SIZE_PX,
    cardSize ?? { width: 0, height: 0 },
    { width: panelRect.width, height: panelRect.height }
  )
  // Hide the card until both the panel AND the card are measured (mirrors the logo's
  // `panelRect.width === 0` gate) so it fades in at the correct anchor instead of at top-left.
  const cardReady = panelRect.width > 0 && cardSize != null

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

  // cosmos-open-prompt-pinned-v1 (OQ-2 / §5): auto-focus the DOCKED textarea on the Cosmos
  // ACTIVATION EDGE (`autoFocusActive` false→true) so the user can type immediately, WITHOUT
  // stealing focus from the Terminal/another panel. Gate on the activation transition (a ref
  // tracks the previous value) — never on every render — and only in docked mode.
  const prevAutoFocusActive = useRef(false)
  useLayoutEffect(() => {
    if (docked && autoFocusActive && !prevAutoFocusActive.current) {
      textareaRef.current?.focus()
    }
    prevAutoFocusActive.current = autoFocusActive
  }, [docked, autoFocusActive])

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
    // Release the frozen open-time anchor so the NEXT open recaptures the logo's live position.
    setOpenAnchor(null)
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
    // cosmos-open-prompt-pinned-v1 (FR-004 / §4.6): the docked Cosmos composer STAYS OPEN after
    // submit — no launch grow-to-fill, no collapse, no "Sent" hint (the timeline's new prompt
    // bubble + generating affordance is the feedback). Just clear + keep focus, chat-style.
    if (docked) {
      textareaRef.current?.focus()
      return
    }
    setLaunching(true) // submit collapse = grow-to-fill + vanish (the "launch")
    // open-prompt-spinner-gating-v1 (OQ-3): acknowledge the accepted submit with the transient
    // "Sent" hint. Non-blocking — if this run turns out to generate a surface, `busy` engages
    // and the render below hides the hint in favour of the surface spinner.
    setSentHint(sentHintAfterSubmit(true).visible)
    collapse(true) // auto-collapse to the logo (FR-006/FR-012)
  }, [value, composerLocked, onSubmit, contextDismiss, collapse, docked])

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
      // cosmos-open-prompt-pinned-v1 (FR-007 / §5): in DOCKED mode Esc is INERT — it never
      // collapses/removes the always-open Cosmos input (it stays a no-op, keeping focus).
      if (event.key === 'Escape') {
        if (!docked && escDecision({ open: expanded, focused: true })) {
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
    [expanded, value, submit, collapse, docked]
  )

  // FR-008: collapse on a click outside the composer root (scoped to the panel region).
  // The DOM hit-test lives here; only the decision is the pure helper.
  // cosmos-open-prompt-pinned-v1 (FR-003/FR-007 / §5): DOCKED mode never collapses on
  // click-outside — the always-open Cosmos input stays docked, so the effect is inert.
  useEffect(() => {
    if (docked || !expanded) {
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
  }, [docked, expanded, collapse])

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

  // cosmos-open-prompt-pinned-v1 (OQ-1 Option A / design §2, INSET refinement): the DOCKED
  // Cosmos chat input. A flat in-flow `<form>` — NO `fixed z-50` drag/logo layer, NO centered
  // glass overlay card, NO scrim/"Sent" hint/position/glass machinery (all floating-only). It
  // is ALWAYS open and ALWAYS interactive (FR-001/FR-003): not hidden by `busy` (FR-005).
  //
  // VISUAL (per the user's refinement): the body is an INSET, ROUNDED card — NOT a full-bleed
  // bottom band. It reuses the floating card's contained shape AND its WIDTH (`w-full max-w-2xl`,
  // the same cap the floating card uses) so the docked input is sized identically to the composer
  // on the other panels — just pinned at the bottom. It stays FLAT (`bg-popover`, no glass
  // material) since it is docked chrome, not a floating overlay. Horizontal centering + the
  // side/bottom margin live on `SharedComposer`'s docked wrapper (`flex justify-center px-3 pb-3`).
  // Returned EARLY so the floating render path below stays byte-for-byte unchanged (FR-011 / SC-006).
  if (docked) {
    return (
      <form
        ref={formRef}
        aria-label={ariaLabel}
        onSubmit={handleSubmit}
        className="w-full max-w-2xl rounded-lg border border-border bg-popover p-2 shadow-sm"
      >
        <div className="flex flex-col gap-2">
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            // Never disabled merely because a run is in flight (`composerLocked` is constant
            // false) — the docked input stays typeable during a run (FR-005).
            disabled={composerLocked}
            placeholder={placeholder}
            aria-label={ariaLabel}
            // Multi-line growth bounds (FR-010 / design §3): grows to ~6–7 lines then scrolls
            // internally; same bounds as the floating card so both composers feel identical.
            className="max-h-[9rem] min-h-[2.5rem] resize-none"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[11px] text-muted-foreground">{HINT_COPY}</span>
            <Button
              type="submit"
              variant="cosmos"
              size="sm"
              disabled={!canSubmit}
              aria-label="Send"
              className="shrink-0"
            >
              Send
            </Button>
          </div>
        </div>
      </form>
    )
  }

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
        className="pointer-events-none fixed z-50"
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
                  // open-prompt-open-at-position-v1: freeze the logo + capture the card anchor at
                  // the button's LIVE position (handles click-to-open mid-settle, OQ-1 FREEZE).
                  openComposer()
                }}
                style={logoGlassStyle}
                className={[
                  // open-prompt-glass: the logo reads as a round GLASS PEBBLE — the shared
                  // `glass-dock` material (translucent fill + edge highlight + depth shadow)
                  // REPLACES the opaque `bg-popover`/`shadow-md`, `rounded-2xl` makes it a rounded
                  // SQUARE (not a circle), and `logoGlassStyle` frosts the panel behind it (fill+blur
                  // only; no refraction map on an element this small). The CosmosMark glyph stays its
                  // own solid color, so it remains crisply legible over the translucent fill.
                  // 테두리 얇게: the explicit `border` (1px) is DROPPED — it stacked on top of the
                  // glass-dock inset edge (`OPEN_PROMPT_GLASS_SHADOW`'s `inset 0 0 0 1px edge`),
                  // reading as a heavy ~2px rim. The inset hairline alone gives a thin, subtle,
                  // glassy edge.
                  'glass-dock relative size-12 rounded-2xl p-0',
                  // draggable affordance (OQ-3 whole-button drag): grab cursor at rest,
                  // grabbing while a drag is active; touch-none so the pointer drag is not
                  // hijacked by scroll/gesture handling.
                  'cursor-grab touch-none active:cursor-grabbing',
                  'transition-[background-color,box-shadow,transform] duration-150 ease-out',
                  // open-prompt-glass: hover lifts the pebble WITHOUT going opaque — the old
                  // `hover:bg-accent` would slam the solid accent token over the translucent glass
                  // fill, killing the frost. A faint translucent-white wash + the deeper shadow keep
                  // the glass look while still reading as a hover.
                  'hover:bg-white/10 hover:shadow-lg active:scale-95',
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

        {/* open-prompt-glass: when EXPANDED, a dock-style scrim dims + disables the panel behind the
            composer and a click-away collapses it (the same modal affordance the detail docks use).
            It is `pointer-events-auto` (so it blocks the panel) ONLY while expanded; absent when
            collapsed so the floating logo never blocks the panel. Sits below the card (rendered
            after it) within the z-50 layer. */}
        {expanded && (
          <div
            aria-hidden="true"
            onClick={() => collapse(true)}
            className="pointer-events-auto absolute inset-0 bg-black/20 transition-opacity duration-200 motion-reduce:transition-none"
          />
        )}

        {/* open-prompt-open-at-position-v1: the EXPANDED card + the "Sent" hint now live in the
            SAME `fixed` panel-box layer (`slotRef`) as the logo, positioned by a `translate3d`
            transform in the SAME px frame so the anchor+clamp is exact (FR-007/SC-004). The card
            opens at the button's clamped anchor (bottom-left co-located with the logo, grows UP),
            replacing the old centered-bottom overlay (supersedes draggable-open-prompt-button-v1
            OQ-4). The "Sent" hint rides just above the logo at its live position. */}

        {/* open-prompt-spinner-gating-v1 (OQ-3): the transient, non-blocking "Sent" hint for a
            plain command. Decorative + pointer-events-none (it never blocks the logo beneath),
            reusing the existing muted-foreground token (same as the composer hint copy). Anchored
            just above the LOGO at its live position and fades out on auto-dismiss. */}
        <span
          aria-hidden="true"
          style={{ transform: `translate3d(${logoPx.x}px, ${logoPx.y - 20}px, 0)` }}
          className={[
            'pointer-events-none absolute left-0 top-0 w-12 text-center',
            'text-[11px] text-muted-foreground',
            'transition-opacity duration-200 ease-out motion-reduce:transition-none',
            showSentHint ? 'opacity-100' : 'opacity-0'
          ].join(' ')}
        >
          Sent
        </span>

        {/* EXPANDED: constrained-width composer card (FR-010), positioned at the button's clamped
            anchor (FR-001/FR-002, OQ-2 = CENTERED-ON-BUTTON → the button sits at the card's CENTER
            on both axes). Opaque (bg-popover) so tickets do not bleed through the card. The
            positioning wrapper carries the `translate3d(cardPx)` + `center` transform-origin so the
            open/close morph + launch grow-fade emanate from the button's center (FR-002/SC-006); the
            scale/opacity/blur animation classes are UNCHANGED on the form. Kept invisible until both
            the panel and the card are measured (`cardReady`) so it never flashes off-anchor (FR-009). */}
        <div
          style={{
            transform: `translate3d(${cardPx.x}px, ${cardPx.y}px, 0)`,
            transformOrigin: 'center'
          }}
          className={[
            // Width is the card width: `max-w-2xl` capped to the panel width so a card wider
            // than a narrow panel shrinks to fit (and the clamp's degenerate pin stays sane).
            'absolute left-0 top-0 w-full max-w-2xl',
            cardReady ? '' : 'invisible'
          ].join(' ')}
        >
        <form
          ref={setFormRef}
          inert={!expanded}
          aria-hidden={!expanded}
          style={cardGlassStyle}
          className={[
            // open-prompt-glass: the card is liquid GLASS — the shared `glass-dock` material class
            // (translucent `--glass-dock-fill` + edge highlight + depth shadow + opaque fallback)
            // REPLACES the opaque `bg-popover`, and `cardGlass.style` adds the per-instance
            // all-edges rounded bezel `backdrop-filter` so the panel content refracts through the
            // card's rounded rim. `rounded-lg` matches `CARD_RADIUS_PX` (the bezel radius). The
            // original `border-input` is dropped — `glass-dock` supplies its own translucent edge.
            'glass-dock w-full rounded-lg border p-2',
            // Submit exit is a GROW-TO-FILL-AND-VANISH "launch" (composer-send-animation-v1
            // FR-001, design §3): on submit the card scales UP well past full size while
            // fading + softening to nothing, as if the prompt is launched into the surface —
            // it does NOT shrink back into the logo. A non-submit dismiss (Esc/outside-click)
            // uses a gentle shrink-fade instead, so only a real send reads as the big expand.
            // `transition-[opacity,scale,filter]` MUST name `scale`/`filter` (Tailwind v4:
            // `scale-*` compiles to a standalone `scale:` prop). Both states stay mounted so
            // the exit fires; reduced motion is an instant swap. Transform-origin is the anchor
            // (`center`, OQ-2/FR-002/SC-006) so the morph emanates from the button's center.
            'origin-center transition-[opacity,scale,filter] duration-[450ms] ease-[cubic-bezier(0.16,1,0.3,1)]',
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
          {/* open-prompt-glass: the per-instance `<svg><filter>` that the card's `backdrop-filter`
              references. Hidden, zero layout footprint — purely the filter definition. */}
          {cardGlass.filter}
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
            // open-prompt-glass LEGIBILITY: the translucent glass fill alone is too low-contrast for
            // a multi-line editing surface, so the textarea keeps a FAINT solid backing (a low-alpha
            // popover tint + hairline) — enough for crisp text without an opaque slab that would
            // defeat the glass look. Placeholder/value inherit the popover foreground token.
            className="max-h-[9rem] min-h-[2.5rem] resize-none rounded-md border border-border/40 bg-popover/55 shadow-none focus-visible:ring-1 focus-visible:ring-ring/40"
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
    </div>
  )
}
