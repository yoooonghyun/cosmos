/**
 * ScrollPolicyScene — renders the TWO scrollbar renderers side by side with overflowing content
 * so a screenshot can confirm they paint the SAME bar (scrollbar-policy-unify-renderer-v1).
 * LEFT = Radix `ScrollArea` (the shared components/ui wrapper); RIGHT = a plain
 * `overflow-auto scrollbar-hover-only` div. After the fix both should be 8px, transparent at rest,
 * muted-foreground thumb on hover — visually identical.
 */
import { ScrollArea } from '@/components/ui/scroll-area'

function Rows({ n, prefix }: { n: number; prefix: string }) {
  return (
    <div className="p-3">
      {Array.from({ length: n }, (_, i) => (
        <p key={i} className="py-1 text-[13px] text-card-foreground">
          {prefix} row {i + 1} — lorem ipsum dolor sit amet consectetur adipiscing elit.
        </p>
      ))}
    </div>
  )
}

export function ScrollPolicyScene() {
  return (
    <div className="flex h-screen w-screen gap-6 bg-background p-6">
      <div className="flex w-80 flex-col">
        <p className="mb-2 text-xs text-muted-foreground">Radix ScrollArea</p>
        <ScrollArea className="h-72 rounded-md border border-border bg-card" data-testid="radix-scroll">
          <Rows n={40} prefix="radix" />
        </ScrollArea>
      </div>
      <div className="flex w-80 flex-col">
        <p className="mb-2 text-xs text-muted-foreground">CSS scrollbar-hover-only</p>
        <div
          data-testid="css-scroll"
          className="h-72 overflow-auto scrollbar-hover-only rounded-md border border-border bg-card"
        >
          <Rows n={40} prefix="css" />
        </div>
      </div>
    </div>
  )
}
