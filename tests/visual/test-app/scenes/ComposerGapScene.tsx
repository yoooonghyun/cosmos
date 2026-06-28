/**
 * ComposerGapScene — renders the REAL docked Cosmos composer (`SharedComposer surface="cosmos"`)
 * so a Playwright spec can MEASURE the px gap between the composer card's bottom edge and the
 * Cosmos footer's top edge (bug terminal-broke-scroll-unify-redo-v1, Task 2).
 *
 * The gap is controlled SOLELY by the docked band's bottom padding (`pb-*`) in
 * `app/SharedComposer.tsx` — the docked `<form>` carries no margin of its own. `SharedComposer`
 * is Monaco-free (extracted to its own module), so it mounts in the Vite harness without pulling
 * App's heavy panel imports. We wrap it in the same provider stack the App uses (Session +
 * OpenPromptPosition + ActiveComposer) and publish a cosmos composer config so it renders the
 * docked branch (composer band → footer).
 */
import { useMemo, useRef } from 'react'
import { SharedComposer } from '@/app/SharedComposer'
import { ActiveComposerProvider, usePublishComposer } from '@/composer/ActiveComposerProvider'
import { SessionProvider } from '@/session/SessionProvider'
import { OpenPromptPositionProvider } from '@/composer/OpenPromptPositionProvider'

// PromptComposer subscribes to `window.cosmos.agent.onStatus` and SessionProvider calls
// `window.cosmos.session.save`. Stub the minimal surface so the real components mount in the
// browser harness (the harness has no preload bridge). Cast: the harness is outside tsconfig.web.
;(window as unknown as { cosmos: unknown }).cosmos = {
  agent: { onStatus: () => () => {}, submit: () => {} },
  session: { save: () => {} }
}

/** Publishes a cosmos composer config so `SharedComposer` reads a non-null config and renders. */
function PublishCosmos(): null {
  const config = useMemo(
    () => ({
      onSubmit: () => {},
      placeholder: 'Describe the UI you want…',
      ariaLabel: 'Compose generated UI',
      busy: false
    }),
    []
  )
  usePublishComposer('cosmos', config)
  return null
}

export function ComposerGapScene() {
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  return (
    <SessionProvider snapshot={null}>
      <OpenPromptPositionProvider>
        <ActiveComposerProvider>
          <PublishCosmos />
          {/* The Cosmos surface column: a flex column the docked band + footer stack inside,
              just like the real CosmosPanel column. Tall + justify-end so the band sits at the
              bottom exactly as in the app — the gap is the band's `pb-*`, independent of height. */}
          <div className="flex h-screen w-screen items-stretch justify-center bg-background">
            <div
              ref={surfaceRef}
              data-testid="cosmos-surface"
              className="flex h-full w-[720px] flex-col justify-end bg-card"
            >
              <SharedComposer surface="cosmos" surfaceRef={surfaceRef} />
            </div>
          </div>
        </ActiveComposerProvider>
      </OpenPromptPositionProvider>
    </SessionProvider>
  )
}
