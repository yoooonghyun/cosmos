import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * Switch — the canonical cosmos on/off control for a binary, immediately-applied
 * preference (settings-redesign-v1 §3). Styling contract: off track `bg-input`
 * (neutral dark), on track `bg-brand-accent` (the product's active color — the
 * solid cosmos brand purple, settings-visual-v1), thumb `bg-background`, and the
 * same `--ring` focus treatment as Button/Input.
 */
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-colors outline-none",
        "data-[state=unchecked]:bg-input data-[state=checked]:bg-brand-accent",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-background shadow-sm ring-0 transition-transform",
          "data-[state=unchecked]:translate-x-0.5 data-[state=checked]:translate-x-4"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
