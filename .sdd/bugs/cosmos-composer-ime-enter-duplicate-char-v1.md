# Bug: Cosmos composer — Enter during IME composition duplicates the last character

ID: `cosmos-composer-ime-enter-duplicate-char-v1`
Status: Fixed
Skill: bugfix
Reported: 2026-06-28

## Symptom

In the Cosmos / Open-Prompt composer, sending an utterance via Enter sends the LAST
character one extra time ("마지막 문자가 한번 더 보내지는데"). Reproducible with Korean
(any IME) input.

## Reproduction

1. Cosmos panel, docked composer.
2. Type a Korean phrase (IME composition active on the final syllable, e.g. `안녕`).
3. Press Enter to send while the last syllable is still composing.
4. The submitted/echoed text carries the final character duplicated.

Deterministic with an IME; does not reproduce with ASCII-only input (no composition).

## Classification

Implementation defect (renderer DOM/event) → `developer` layer. The Enter keydown handler
omits the standard IME-composition guard.

## Root cause

`src/renderer/composer/PromptComposer.tsx:845` —
`if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() }`
does NOT check `event.nativeEvent.isComposing`. While an IME is composing, the Enter that
COMMITS the syllable fires a `keydown` with `isComposing === true` (keyCode 229). The handler
treats it as a submit-Enter and submits, while the IME independently flushes the composed
character — so the final character is emitted twice. The universal fix is to ignore Enter
while `isComposing`.

## Fix

Guard the Enter branch with `event.nativeEvent.isComposing` (bail early; let the IME finish
the commit — the user presses Enter again to actually send).

## Regression test

jsdom `*.dom.test.tsx` (`npm run test:dom`): `fireEvent.keyDown(textarea, { key:'Enter',
isComposing:true })` must NOT call `onSubmit`; a normal `{ key:'Enter' }` still submits once.
Fails before the guard (submit fires during composition), passes after.

## Verification

`npm run typecheck`, `npm test`, `npm run test:dom` green incl. the new case.

## Resolution (2026-06-28)

`PromptComposer.tsx:845` Enter branch now also requires `!event.nativeEvent.isComposing`. One
`handleKeyDown` is shared by both the docked and expanded composer forms, so the single guard
covers every path. Regression: `PromptComposerDocked.dom.test.tsx` — Enter with
`isComposing:true` does NOT submit, a following plain Enter submits exactly once with the
intact `안녕`.

Verified: typecheck clean; node-unit **2573 passed**; jsdom **26 passed** (+1). The dom test
passing is itself the red→green proof — without the guard the composing-Enter would submit,
pushing the later `toHaveBeenCalledTimes(1)` to 2.

**Live GUI (`npm run dev`) not exercised** — needs a real IME (Korean) Enter-to-send to
eyeball; logic + event path verified at the jsdom layer.
