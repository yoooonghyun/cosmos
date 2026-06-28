import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge does NOT know the project's CUSTOM `@theme` font-size tokens
 * (`--text-nano…--text-title`, DESIGN.md §8), so by default it classifies e.g.
 * `text-body` as a text-COLOR utility. A `cn("text-body text-muted-foreground", …)`
 * then puts both in the color group and DROPS `text-body` — the element silently
 * falls back to the inherited 16px (the recurring "dialog description size is wrong /
 * tokens look off" defect). Registering the custom names in the `font-size` group makes
 * tailwind-merge treat them as sizes, so a size + a color no longer collide.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['nano', 'micro', 'caption', 'body-sm', 'body', 'title'] }]
    }
  }
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
