/**
 * MessageSkeleton — the generated Slack list's loading skeleton
 * (slack-generative-message-parity-v1, FR-014, design §5). Shaped to MATCH the native
 * `MessageSkeletons` (`SlackPanel.tsx`) exactly, built from the same `Skeleton` primitive,
 * so the generated and native loading states read identically. Shown by the three bound
 * catalog lists while a refresh is in flight (or before the first load), instead of the
 * "No content" empty state. One component, three callers (design §5.1).
 */

import { Skeleton } from '@/components/ui/skeleton'

/** Four message-shaped skeleton rows (avatar circle + name bar + body bar). */
export function MessageSkeleton(): React.JSX.Element {
  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-3 p-3" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex gap-2.5">
          <Skeleton className="size-6 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  )
}
