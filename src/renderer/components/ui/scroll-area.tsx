import * as React from "react"
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { SCROLL_AREA_VIEWPORT_CLASS } from "./scroll-area.classes"

function ScrollArea({
  className,
  children,
  ref,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root
      ref={ref}
      data-slot="scroll-area"
      className={cn("relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        // The `[&>div]:!block [&>div]:!min-w-full` segment defeats Radix's inline
        // `display: table` content wrapper so `whitespace-pre-wrap` text wraps to the
        // panel width instead of overflowing horizontally (bug slack-message-overflow-wrap).
        className={SCROLL_AREA_VIEWPORT_CLASS}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      // scrollbar-policy-unify-renderer-v1: match the CSS `scrollbar-hover-only` policy EXACTLY so a
      // Radix ScrollArea and a plain `overflow-auto scrollbar-hover-only` div paint the SAME bar
      // (one visual policy, no per-panel drift). 8px track (was 10px), no border. Radix's default
      // `type="hover"` already hides the bar at rest and reveals on the area's hover.
      className={cn(
        "flex touch-none p-px transition-colors select-none",
        orientation === "vertical" && "h-full w-2",
        orientation === "horizontal" && "h-2 flex-col",
        className
      )}
      {...props}
    >
      {/* Thumb = the same muted-foreground tint the CSS utility uses on hover (45% at rest of the
          revealed bar, 70% on direct thumb hover), rounded, so the two renderers are visually
          identical. (Radix only shows the thumb while the area is hovered, matching hover-reveal.) */}
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-muted-foreground/45 transition-colors hover:bg-muted-foreground/70"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }
