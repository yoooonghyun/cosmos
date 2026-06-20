# Design: Terminal Open-Directory Picker — v1

**Status**: Draft
**Created**: 2026-06-18
**Spec**: `.sdd/specs/terminal-open-directory-picker-v1.md`
**Plan**: `.sdd/plans/terminal-open-directory-picker-v1.md`
**Scope**: ONLY the [Open] empty-state (awaiting-directory) visual for the terminal pane. No process/IPC behavior — that is the plan's domain.

---

## Grounding

> Tools run directly for this design pass (not handed in).

**codegraph_explore**

- `TerminalPanel empty state Button terminal pane spawn claude` — returned verbatim source of `TerminalView`/`TerminalPanel` (`src/renderer/TerminalPanel.tsx`) and the `Button` primitive (`src/renderer/components/ui/button.tsx`). Takeaways: the terminal pane is a raw xterm.js surface on `#1e1e1e` (NOT a `bg-card` panel — set in `Terminal({ theme: { background: '#1e1e1e' } })` and `.terminal-panel { background: #1e1e1e }`). The exit banner is the only existing overlay/affordance and uses bespoke `.terminal-panel__*` CSS, NOT a token/shadcn treatment. The xterm container `.terminal-panel__xterm` fills the pane (`flex: 1 1 auto`). `Button` variants available: `default`, `cosmos`, `destructive`, `outline`, `secondary`, `ghost`, `link`; sizes `xs/sm/default/lg/icon*`.
- Grep `empty|Empty|text-muted-foreground` across `src/renderer/*.tsx` — confirmed the house empty-state shape (Slack `BoundChannelList`, `atlassianPanelBits.EmptyLine`, GCal `MonthEmptyNote`): a centered column `flex flex-col items-center gap-2 … text-center`, a lucide glyph at `size-7 text-muted-foreground`, and `text-sm text-muted-foreground` copy. The connect CTA (`ConnectForm`, `atlassianPanelBits.tsx`) is the closest precedent for an action-in-empty-state: `Button` + a one-line `text-xs text-muted-foreground` helper underneath, and a pending state that swaps the label for `<Loader2 className="size-3.5 animate-spin" /> Connecting…` with `disabled`.

**memory_recall**

- `cosmos design system empty state terminal panel Tailwind shadcn Button` — no stored prior decisions on the terminal empty state. Closest standing preferences (MEMORY.md): cosmos UI = a real Tailwind + shadcn design system (use the `Button` primitive, not hand-rolled), dark-first VS Code palette. No conflict.

**Copy-tone check**

- Existing action copy is English, sentence-case, verb-first, terse: "Restart claude", "Connect Slack", "Connecting…", "No channels.". House style is English (not Korean), so the label is **"Open a folder"** — not "디렉터리 열기".

---

## 1. Surface & layout

One surface only: the **awaiting-directory empty state**, shown inside a terminal tab's pane (`TerminalView`) while `phase === 'awaiting'` (before any `claude` spawn). It lives in the same box the xterm renders into — `src/renderer/TerminalPanel.tsx`, inside the `.terminal-panel` view container, rendered INSTEAD OF / OVER the xterm fill while awaiting.

Layout: a single centered column floated in the middle of the terminal pane.

```
┌──────────────────────────── terminal pane (#1e1e1e) ────────────────────────────┐
│                                                                                  │
│                                                                                  │
│                                  [ FolderOpen ]        ← lucide glyph, muted     │
│                                                                                  │
│                            Open a folder to start         ← title, foreground    │
│                                                                                  │
│              Claude Code will run in the folder you choose.   ← helper, muted    │
│                                                                                  │
│                              ┌──────────────────┐                                │
│                              │   Open a folder   │   ← Button (cosmos, sm)        │
│                              └──────────────────┘                                │
│                                                                                  │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Container

The empty state is its own element that fills the pane and centers its content. The xterm container stays mounted but is hidden while awaiting (so subscriptions stay wired per the plan; only its visibility toggles).

Empty-state container classes:

```
flex flex-1 min-h-0 flex-col items-center justify-center gap-3 px-6 text-center
```

- Background: inherits the pane's `#1e1e1e` from `.terminal-panel` — do NOT add a `bg-card`/`bg-background`; the terminal pane is intentionally the darker raw-terminal black, and the empty state must read as "this terminal, empty", not as a different panel.
- `select-none` may be added to the container so the prompt text isn't accidentally selected like terminal output.

### Inner content stack (top → bottom)

| Element | Classes | Notes |
|---|---|---|
| Icon | `FolderOpen` from `lucide-react`, `className="size-7 text-muted-foreground"`, `aria-hidden="true"` | Matches the `size-7 text-muted-foreground` empty-state glyph used in Slack/GCal. `FolderOpen` reads as "choose a directory". |
| Title | `<p className="text-sm font-medium text-foreground">Open a folder to start</p>` | One notch brighter than helper text (`text-foreground`) so the prompt has a clear primary line, consistent with `ConnectForm` hierarchy. |
| Helper | `<p className="max-w-xs text-xs text-muted-foreground">Claude Code will run in the folder you choose.</p>` | Explains the consequence of the choice. `max-w-xs` keeps it to ~2 lines in a wide pane. |
| Button | see §3 | Sits below the helper, ~`mt-1` of breathing room via the container `gap-3`. |

Vertical rhythm comes from the container `gap-3` (12px) between glyph / title-block / button; title and helper sit tight together, so wrap them in a `<div className="flex flex-col items-center gap-1">` so glyph→titleblock→button are the three `gap-3` rows and title↔helper are a tighter `gap-1`.

---

## 2. Tokens used

All existing tokens — **no new token required.**

| Token | Where |
|---|---|
| `--foreground` (`text-foreground`) | title line |
| `--muted-foreground` (`text-muted-foreground`) | icon + helper text |
| `--primary` via `Button` `cosmos`/`default` variant | the [Open] button |
| pane background `#1e1e1e` | inherited from `.terminal-panel` (existing `.css`, unchanged) — NOT re-declared here |
| `--ring` (`focus-visible:ring-ring/50`) | button focus ring, from the `Button` primitive |

No raw hex is introduced by this surface; the only `#1e1e1e` involved is the pre-existing pane background the state sits on.

---

## 3. Component used — the [Open] button

**Reuse the existing `Button` primitive** (`src/renderer/components/ui/button.tsx`). No new primitive, no new variant.

- **Variant**: `cosmos` — `Button variant="cosmos"`. Rationale: this is the single, inviting primary call-to-action on an otherwise empty dark pane (the "let's get started" moment), which is exactly what the brand `cosmos` gradient variant exists for. It gives the empty terminal one warm focal point against the flat black, and differentiates "start a session" from the destructive/neutral chrome elsewhere. (If the team prefers a flatter look, `variant="default"` — solid `--primary` — is the fallback; same size/states. Pick `cosmos`.)
- **Size**: `sm` — `size="sm"` (h-8). Compact, matches the `ConnectForm` CTA scale; the pane is utilitarian, not a hero screen.
- **Icon**: lead the label with `FolderOpen` at the button's default svg size (the primitive auto-sizes `[&_svg]:size-4`). `<Button variant="cosmos" size="sm"><FolderOpen /> Open a folder</Button>`. The `has-[>svg]` padding rules in the primitive handle spacing.
- **Label**: **"Open a folder"** (English, sentence-case, verb-first — house tone). Same string as the title's verb so the affordance is unmistakable.

> Note: a top-level icon already appears in the empty state (§1). Keeping a small `FolderOpen` inside the button too is fine and reinforces the action; if it feels redundant, drop the button's leading icon and keep the standalone glyph. Default: keep both — the standalone glyph is decorative/muted, the button glyph is the action.

---

## 4. States

This surface is itself a single state of the tab (the "empty / awaiting" state in the larger loading/empty/populated/error model — "populated" = the live xterm, which replaces this surface entirely; "error" does not apply because a cancelled picker is explicitly NOT an error per FR-006). The states below are the button's interaction states plus the brief pending state.

| State | Trigger | Visual |
|---|---|---|
| **Default** | Tab freshly opened, awaiting a directory | Centered column as in §1. Button at rest: `cosmos` gradient (`from-brand-pink to-brand-purple`), `text-brand-foreground`, `shadow-sm`. |
| **Hover** | Pointer over the button | From the primitive: `hover:brightness-95` (gradient dims slightly). No custom hover. |
| **Focus (keyboard)** | Button receives focus via Tab | From the primitive: `focus-visible:border-ring` + `focus-visible:ring-[3px] focus-visible:ring-ring/50`. The ring reads clearly against `#1e1e1e`. No custom focus styling. |
| **Pending** (dialog open) | Click → while the native OS directory picker is open | Set the button `disabled` and swap its content to a spinner + "Opening…": `<Button variant="cosmos" size="sm" disabled><Loader2 className="size-3.5 animate-spin" /> Opening…</Button>`. The primitive applies `disabled:opacity-50 disabled:pointer-events-none`, so the gradient dims and the control is inert (prevents a second dialog). This mirrors the `ConnectForm` "Connecting…" pending pattern. |
| **Return-to-default after cancel** | User cancels/dismisses the picker (FR-006) | Button returns to **Default** exactly. NO error text, NO color change, NO toast. The pane stays in the awaiting empty state, fully reusable — clicking again re-opens the picker. |
| **Disabled (n/a as a resting state)** | — | There is no independent "disabled" resting state for this affordance; the only disabled moment is the transient Pending state above. The button is always actionable except while a dialog is already open. |

Pending-state copy: **"Opening…"** (matches "Connecting…" cadence — present participle + ellipsis). The pending window is brief (just until the OS dialog appears/closes); the spinner is mostly insurance against double-clicks rather than a long wait, but it keeps the affordance honest.

Transition out: on a confirmed selection the whole empty state unmounts/hides and the live xterm becomes visible (the plan's `phase: 'awaiting' → 'live'`). No animated transition is specified — an instant swap to the terminal is correct and matches how the exit banner appears/disappears.

---

## 5. Interaction & accessibility

- **Focus order**: the [Open] button is the only focusable element in this surface; it should be reachable by Tab when its tab is active. When a fresh tab becomes active, focus MAY be placed on the button (so Enter/Space starts the flow without a mouse) — optional but recommended, mirroring how the live terminal auto-focuses the xterm. Implementer's call; not required for correctness.
- **Keyboard**: native `<button>` semantics from the primitive — Enter and Space activate. No custom key handling.
- **Pending lock**: while Pending, `disabled` removes the button from the tab order and blocks re-activation, so a user cannot open two dialogs.
- **Screen reader / ARIA**:
  - Decorative glyphs (standalone `FolderOpen`, in-button `FolderOpen`, `Loader2`) carry `aria-hidden="true"`.
  - The button's accessible name comes from its text ("Open a folder" / "Opening…"). No extra `aria-label` needed since the label is descriptive.
  - The empty-state container SHOULD be a `<div role="group" aria-label="No session — open a folder to start">` (or rely on the surrounding `role="tabpanel" aria-label="Terminal session"` already present and leave the group unlabeled). Minimal: no new ARIA region is strictly required; the existing tabpanel labeling suffices.
  - Pending: when the label flips to "Opening…", the button text change is announced naturally on focus; an `aria-live` region is NOT needed (the dialog itself takes focus).
- **Contrast** (against `#1e1e1e`):
  - `text-foreground` (≈`#e0e0e0`) title on `#1e1e1e` → strong contrast, passes AA.
  - `text-muted-foreground` icon + helper → the same muted token used in every other empty state on darker/card backgrounds; it is intentionally low-emphasis. It reads against `#1e1e1e`; if it proves too dim on the raw-terminal black specifically, that is a system-wide muted-token concern, not a one-off — flag to the token owners rather than overriding here (see §7).
  - `cosmos` gradient button uses `text-brand-foreground` on the pink→purple gradient — the brand pairing is already AA-tuned by the brand tokens.

---

## 6. What to build (handoff summary)

Inside `TerminalView` (`src/renderer/TerminalPanel.tsx`), when `phase === 'awaiting'`, render (instead of showing the xterm fill):

```tsx
<div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-3 px-6 text-center select-none">
  <FolderOpen className="size-7 text-muted-foreground" aria-hidden="true" />
  <div className="flex flex-col items-center gap-1">
    <p className="text-sm font-medium text-foreground">Open a folder to start</p>
    <p className="max-w-xs text-xs text-muted-foreground">
      Claude Code will run in the folder you choose.
    </p>
  </div>
  <Button variant="cosmos" size="sm" disabled={pending} onClick={onOpen}>
    {pending ? (
      <><Loader2 className="size-3.5 animate-spin" /> Opening…</>
    ) : (
      <><FolderOpen /> Open a folder</>
    )}
  </Button>
</div>
```

- `pending` is a local boolean set true right before `await window.cosmos.pty.pickDirectory()` and false after it resolves (whether a path or `null` comes back). The plan owns the spawn/cancel/mounted-guard logic; this design only fixes the visual and the disabled/spinner treatment while the dialog is open.
- Import `FolderOpen` and `Loader2` from `lucide-react` (both already used elsewhere in the renderer), and `Button` from `@/renderer/components/ui/button` (path per existing imports / `cn` convention).
- The exit banner (`.terminal-panel__exit`) and the live xterm path are UNCHANGED. This state is mutually exclusive with the live terminal: awaiting → (pick) → live.

---

## 7. New token / primitive required?

**No.** This surface is fully expressible in existing tokens (`--foreground`, `--muted-foreground`, `--primary`/brand via the `Button` `cosmos` variant) and the existing `Button` primitive + existing lucide icons. No edit to `src/renderer/index.css` or `src/renderer/components/ui/` is needed or made in this pass.

**One thing to watch (flag, not a change):** `text-muted-foreground` on the raw-terminal `#1e1e1e` background is slightly darker than the card backgrounds where the muted token is normally used. If, in review on-device, the helper text reads too dim specifically on the terminal black, the correct fix is a system-level decision by the token owners (e.g. confirming the muted token's contrast floor) — NOT a bespoke lighter color on this surface. Raised here so it converges to the system rather than diverging.

---

## 8. Open questions

- None blocking. Two soft choices left to the implementer, both with a stated default:
  1. **Auto-focus the [Open] button** when a fresh tab activates (recommended for keyboard-first start; default: yes, but harmless either way).
  2. **In-button leading `FolderOpen` glyph** vs. label-only (default: keep the leading glyph; drop it only if the standalone glyph above makes it feel redundant).
- Variant fallback noted in §3: if the team rejects the brand `cosmos` gradient for the terminal pane, use `variant="default"` (solid `--primary`) — same size, copy, and states.
