# Bug: Home FAVORITE tab shows NO footer (the "Home" name+status strip)

ID: `home-favorite-missing-footer-v1`
Status: Fixed (pending a live-dev visual confirm)
Skill: bugfix
Reported: 2026-06-30

## Symptom (user)

The default Cosmos (Home) tab has the bottom footer (the "Home" name+status strip). When a Home
FAVORITE tab is active, the footer DISAPPEARS — the favorite tab has no footer at the bottom.

## Root cause

The "Home" footer is rendered in `SharedComposer.tsx`'s `docked` branch
(`<PanelFooter surfaceName="Home" …/>`, BELOW the composer band — footer-placement-cosmos-terminal-v1).
But `SharedComposer` had an EARLY OUT before that branch:

- `src/renderer/app/SharedComposer.tsx:34` `const config = useActiveComposerConfig(surface)`
- `src/renderer/app/SharedComposer.tsx:40-42` `if (!config) { return null }`

The footer was WRONGLY COUPLED to the composer config: it only rendered when a non-null `'cosmos'`
config existed. Per cosmos-home-favorite-tabs-v1's full-width source-mirror correction, when a
FAVORITE tab is active `CosmosPanel` publishes a NULL `'cosmos'` composer config (it hides the
docked Cosmos composer and overlays the SOURCE panel's OWN floating Open-Prompt instead — see
TEST-SCENARIOS COSMOS-FAVORITE-TABS-01). So `config` is null → the early `return null` fired →
the ENTIRE docked return (composer band AND footer) vanished → the favorite tab had no footer.

(Confirmed via codegraph: `useActiveComposerConfig`'s only `SharedComposer`/`CosmosPanel` callers,
plus the docked-branch source.)

## Fix (minimal, root-cause)

Decouple the footer from the composer config in the cosmos/docked case. In `SharedComposer.tsx`:

- Removed the blanket `if (!config) return null` early-out.
- The composer element is now built only when `config` is present (`const composer = config ? (…) : null`).
- The `docked` branch renders the `PanelFooter surfaceName="Home"` ALWAYS, and the composer BAND
  only when `composer` is non-null. Footer status: `config?.busy ? 'in-flight' : 'idle'` — idle
  "Home" when config is null (favorite active), busy-driven when a config is present (as before).
- The `floating` branch (every other surface) keeps its null-config short-circuit (`if (!composer)
  return null`) so a disconnected integration still renders no chrome.

No change to the default-tab docked layout: composer band (`shrink-0 justify-center … pb-8`) →
footer order and the `pb-8` gap are preserved; the floating composer for other panels is unchanged.

## Classification

Implementation/layout coupling defect → handled inline (contained renderer change, root cause known,
no contract/IPC/design change).

## Regression test

jsdom (`src/renderer/app/CosmosFooterOrder.dom.test.tsx`), adjacent to
footer-placement-cosmos-terminal-v1 — extended, not contradicted (the composer→footer order
invariant is re-asserted in the config-present case). New `describe`
"Cosmos docked footer survives a null config":

- NO published cosmos config (favorite-active) → the "Home" `PanelFooter` (aria-label "Panel" /
  text "Home") IS present AND the composer textarea is ABSENT.
- config present → BOTH present, composer precedes footer (order invariant kept).

RED→GREEN evidence: with the old `if (!config) return null` restored, the null-config row fails
(`Unable to find a label with the text of: Panel`; rendered body is an empty `<div/>`); with the
fix all 5 rows in the file pass.

TEST-SCENARIOS.md: add a row under the footer/CMP cluster (see below).

## Verification

`npm run typecheck` + `npm test` (node-unit) + `npm run test:dom` green. The footer-present /
composer-absent behavior is structurally guaranteed by the docked branch (footer outside the
`composer && …` guard). NOT exercised in the live app — open a favorite tab in `npm run dev` to
eyeball the Home footer present at the bottom of a favorite tab.
