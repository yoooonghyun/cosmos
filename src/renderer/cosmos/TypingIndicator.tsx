/**
 * TypingIndicator — the chat "assistant is composing a reply" affordance for the Cosmos
 * conversation timeline (cosmos-conversation-panel-v2). It replaces the gen-UI
 * `SurfaceSpinner` in the `live-generating` branch of {@link CosmosTimelineEntry}: that
 * full-height, vertically-centered "Generating…" sparkle is meant ONLY for a generative
 * panel composing a SURFACE into its tabpanel body. In a CHAT timeline the busy state must
 * read as a turn-in-progress, so this sits INLINE in the message flow, LEFT-aligned (the
 * assistant side — `UserBubble` is right-aligned/accent-tinted), as three pulsing dots.
 *
 * The "generating" phase precedes knowing whether the reply is assistant text or a
 * generated surface (either becomes a separate timeline entry once it lands), so this is
 * the GENERIC waiting indicator for both.
 *
 * a11y: `role="status"` + `aria-live="polite"` + `aria-busy="true"`, with an off-screen
 * accessible name ("Assistant is responding…"). The dots are `aria-hidden` decoration.
 *
 * Motion (DESIGN.md §12): the dot pulse lives in `src/renderer/index.css` as the
 * `cosmos-typing-dot` keyframes/class, gated behind `@media (prefers-reduced-motion:
 * no-preference)` — the SAME reduced-motion model as `cosmos-spinner-*`. Under reduced
 * motion the dots render static at their authored base opacity (still legible) and the
 * `role="status"`/`aria-busy` text carries the busy meaning.
 */
export function TypingIndicator(): React.JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex w-fit items-center gap-1 rounded-2xl rounded-bl-sm bg-muted/40 px-3 py-2"
    >
      <span className="sr-only">Assistant is responding…</span>
      <span aria-hidden="true" className="flex items-center gap-1">
        <span className="cosmos-typing-dot size-1.5 rounded-full bg-muted-foreground" />
        <span className="cosmos-typing-dot size-1.5 rounded-full bg-muted-foreground" />
        <span className="cosmos-typing-dot size-1.5 rounded-full bg-muted-foreground" />
      </span>
    </div>
  )
}
