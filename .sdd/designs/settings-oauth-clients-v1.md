# Design: Settings — OAuth Client Configuration — v1

**Status**: Draft
**Created**: 2026-06-15
**Spec**: .sdd/specs/settings-oauth-clients-v1.md
**Plan**: .sdd/plans/settings-oauth-clients-v1.md
**Owner**: designer

---

## Grounding

**codegraph_explore** (queries run, one-line takeaways):
- `App.tsx AppShell TabsList rail RAIL_ITEMS sidebar PromptComposer dialog overlay` → the left rail is a Radix vertical `Tabs` `TabsList` in `AppShell` (`App.tsx:117`), width `w-12`, `bg-popover`, `border-r border-border`, `p-0 py-2`; each `TabsTrigger` is a `h-10 w-10` icon button (`size-5` lucide icon) with a left primary indicator bar + `bg-secondary!` active pill, each wrapped in a `Tooltip`/`TooltipContent side="right"`. The whole shell is already inside one `TooltipProvider delayDuration={300}`. The gear must sit at the BOTTOM of this `TabsList` and must NOT be a `TabsTrigger` (Radix roving-tabindex would treat it as a tab; it is a plain button).
- `SlackPanel connect button status not-connected ConfluencePanel JiraPanel connect OAuth panel footer form` → confirmed the established form/status vocabulary I must match: `ConnectForm` (`SlackPanel.tsx:308`) uses `Alert` + `AlertTitle`/`AlertDescription` for connection errors and a `Button` with `Loader2 className="size-3.5 animate-spin"` + "Connecting…" for in-progress; inline error chips elsewhere use `border-destructive/40 bg-destructive/15 text-destructive`. Inputs use the `Input` primitive at `h-8 text-sm` inside panels. These are the patterns the dialog reuses verbatim.
- Read `src/renderer/index.css` → full token set confirmed (dark values: `--background #1e1e1e`, `--foreground #e0e0e0`, `--card #1b1b1c`, `--popover #252526`, `--primary #4a9eff`, `--secondary #3a3a3c`, `--muted #252526`, `--muted-foreground #888`, `--border #333`, `--input #4a4a4c`, `--ring #4a4a4c`, `--destructive #f3b0b0`/`--destructive-foreground #1e1e1e`). No new token needed.
- Read `src/renderer/components/ui/` (Glob) → vendored primitives: `button`, `input`, `badge`, `tooltip`, `alert`, `card`, `select`, `textarea`, `scroll-area`, `skeleton`, `avatar`, `tabs`. **No `dialog.tsx` and no `label.tsx`.** Both must be vendored (see "New primitives").
- Read `components.json` + `package.json` grep → shadcn `new-york` style, `lucide` icon library, **unified `radix-ui@^1.4.3`** package (so `Dialog` ships from the same package already in use — `import { Dialog as DialogPrimitive } from "radix-ui"`, matching `tabs.tsx`/`tooltip.tsx`), `lucide-react@^1.17.0` present (provides `Settings`/`Loader2`/`Check`/`RotateCcw`/`AlertTriangle`).

**memory_recall**: `cosmos design system tokens shadcn dialog input panel styling` → no stored result. Standing preference (MEMORY.md): cosmos wants a real shadcn component-library design system, not token-only; secrets stay in main and never reach the renderer (reinforced here by the write-only secret affordance).

---

## Surfaces & layout

Two surfaces: (A) the **gear button** at the bottom of the left rail; (B) the **Settings dialog** opened from it.

### A. Gear button (bottom of left rail)

Lives inside the existing `TabsList` in `AppShell` (`App.tsx`), appended AFTER the `RAIL_ITEMS.map(...)`. The `TabsList` already uses `flex-col`; to pin the gear to the bottom, insert a flexible spacer so the surface triggers stack at top and the gear sinks to the bottom:

```
TabsList (w-12, flex-col, py-2, gap-1)
 ├─ RAIL_ITEMS triggers (Terminal, Generated UI, Slack, Jira, Confluence)  ← top group
 ├─ <div className="flex-1" aria-hidden />                                  ← spacer pushes gear down
 └─ Settings gear button (non-tab)                                          ← bottom, with a top divider
```

- The gear is a plain `Button variant="ghost" size="icon"` (NOT a `TabsTrigger`), so Radix does not fold it into the tab roving-tabindex. Render it inside its own `Tooltip` (the shell's single `TooltipProvider` covers it), `TooltipContent side="right"` label "Settings".
- Size + icon match the rail exactly: outer hit target `h-10 w-10` (override `size="icon"`'s `size-9` via `className="h-10 w-10"`), `Settings` lucide icon at `size-5`, `rounded-md`, centered.
- **Visual separation from the surface tabs above:** a `1px` top divider — `border-t border-border` with a small `mt-1 pt-2` — sits between the spacer and the gear so it reads as chrome/utility, not another surface. The gear NEVER shows the active primary-indicator bar (it is not a surface), distinguishing it from the rail items.

### B. Settings dialog

A centered modal `Dialog` over the whole app (Radix `Dialog.Portal` + overlay). Single column, comfortable for the three fields. Structure top→bottom:

```
DialogOverlay (scrim)
DialogContent  (max-w-[460px], bg-popover, border-border, rounded-lg, shadow-lg, p-0 wrapper)
 ├─ DialogHeader      ── padding px-6 pt-6
 │    ├─ DialogTitle        "Settings"
 │    └─ DialogDescription  "Configure the OAuth client credentials cosmos uses to connect integrations."
 │
 ├─ Body  ── px-6 py-5, vertical-scroll if needed (max-h cap), space-y-6
 │    ├─ Integration group: Slack
 │    │    ├─ group header  (SiSlack icon size-4 + "Slack" + section caption)
 │    │    └─ Field: Slack Client ID   (text Input + source badge + per-field reset)
 │    │
 │    ├─ separator (border-t border-border)
 │    │
 │    └─ Integration group: Atlassian
 │         ├─ group header  (SiJira/SiConfluence pair or a generic Atlassian glyph + "Atlassian"
 │         │                 + caption "One client for Jira and Confluence.")
 │         ├─ Field: Atlassian Client ID   (text Input + source badge + per-field reset)
 │         └─ Field: Atlassian Client Secret  (write-only — status row + set/replace input + clear)
 │
 ├─ Save-feedback slot  ── px-6 (Alert, only when error; inline success affordance otherwise)
 │
 └─ DialogFooter  ── px-6 pb-6 pt-2, justify-end gap-2
      ├─ Button variant="ghost"      "Close"        (DialogClose)
      └─ Button variant="default"    "Save"          (primary)
```

Each **Field** is a vertical stack:
```
<div class="space-y-1.5">
  <div class="flex items-center justify-between">
     <Label>…</Label>                         ← left
     <source badge / reset control cluster>   ← right
  </div>
  <Input … />                                 ← or the secret status+entry row
  <p class="text-xs text-muted-foreground">helper / consequence note</p>   ← optional
</div>
```

The dialog opens with data from `settings.getConfig()` (a `ClientConfigStatus`). While that first fetch is outstanding the body shows a brief loading state (see States).

---

## Tokens used

All existing — **no new token, no raw hex**.

| Role | Token |
|------|-------|
| Dialog surface | `bg-popover` / `text-popover-foreground`, `border-border`, `rounded-lg`, `shadow-lg` |
| Overlay scrim | `bg-black/60` (shadcn dialog default) or `bg-foreground/10` — use the shadcn default `bg-black/60` for the dim scrim; it is theme-agnostic dimming, not a palette color |
| Field input | `Input` primitive → `border-input`, `bg-input/30`, `text-foreground`, `placeholder:text-muted-foreground`, focus `ring-ring/50` + `border-ring` |
| Labels | `text-foreground` (Label primitive default) |
| Section headers / captions / helper text | `text-muted-foreground` |
| Group separators | `border-border` |
| Source badge "Settings" | `Badge variant="secondary"` (`bg-secondary text-secondary-foreground`) |
| Source badge "from .env" | `Badge variant="outline"` (`border-border text-foreground`, muted feel) |
| "Not configured" status | `text-muted-foreground` (no color alarm — neutral, it is a valid state) |
| "Configured" status | `Check` icon `text-primary` + `text-foreground` label |
| Reset / clear control | `Button variant="ghost" size="xs"` with `RotateCcw` icon, `text-muted-foreground hover:text-foreground` |
| Save (primary) | `Button variant="default"` → `bg-primary text-primary-foreground` |
| Save in-progress | `Loader2 animate-spin` inside the primary Button (matches `ConnectForm`) |
| Save success | inline `Check` `text-primary` + "Saved" caption (transient) |
| Save error | `Alert variant="destructive"` → `text-destructive`, `AlertTitle`/`AlertDescription` (matches `ConnectForm`) |
| Force-disconnect consequence note | `text-muted-foreground` inline caption with `AlertTriangle` `size-3.5`; escalates to `Alert` (default, not destructive) on the active changed field |
| Focus ring (all interactives) | `ring-ring/50` + `border-ring` (primitive defaults) |

The destructive token in cosmos dark is the soft `#f3b0b0` foreground — already legible on `#252526` popover; the error `Alert` reuses the exact `ConnectForm` treatment so Settings errors and connect errors look identical.

---

## Components used

Reused from `src/renderer/components/ui/` (no restyle):
- **`Button`** — `default` (Save), `ghost` (Close, gear, per-field reset/clear), `size="icon"` (gear, overridden to `h-10 w-10`), `size="xs"` (reset/clear controls).
- **`Input`** — Slack Client ID, Atlassian Client ID (`type="text"`), and the secret entry (`type="password"`).
- **`Badge`** — `secondary` ("Settings" source), `outline` ("from .env" source).
- **`Tooltip` / `TooltipTrigger` / `TooltipContent`** — gear "Settings" label (`side="right"`); optionally the reset control's "Reset to .env default".
- **`Alert` / `AlertTitle` / `AlertDescription`** — save error (variant `destructive`) and the force-disconnect confirm note (variant `default`).
- lucide-react icons: `Settings` (gear), `Loader2` (save spinner), `Check` (configured / saved), `RotateCcw` (reset to env), `AlertTriangle` (consequence note), `X`/`Trash2` (clear secret). `SiSlack`/`SiJira`/`SiConfluence` (from `react-icons`, already used in `RAIL_ITEMS`) for group headers.

**New primitives to vendor** (developer / main session runs the shadcn CLI — designer has no Bash):
- **`dialog`** — `npx shadcn@latest add dialog` → `src/renderer/components/ui/dialog.tsx`. Provides `Dialog`, `DialogTrigger`, `DialogPortal`, `DialogOverlay`, `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`, `DialogClose`. Backed by `radix-ui`'s `Dialog` (same unified package already in `tabs.tsx`/`tooltip.tsx`), so it inherits the focus-trap, Esc-to-close, scroll-lock, and `aria-modal` wiring for free. Confirm the generated import uses `import { Dialog as DialogPrimitive } from "radix-ui"` to match the repo convention (the new-york default sometimes emits `@radix-ui/react-dialog`; if so, the developer should normalize it to the unified import like the other primitives).
- **`label`** — `npx shadcn@latest add label` → `src/renderer/components/ui/label.tsx`. Needed for accessible field labels (`htmlFor` wiring) and the secret's description association. Radix `Label` from the unified package.

No other primitive needed. The dialog is fully expressible in the existing system plus these two standard shadcn primitives.

---

## States

### A. Gear button states

| State | Treatment |
|-------|-----------|
| Idle | `text-muted-foreground`, transparent bg, `Settings` icon `size-5`. |
| Hover | `hover:bg-accent hover:text-accent-foreground` (ghost default) → icon brightens to foreground, subtle `--accent #2d2d30` pill. |
| Focus-visible | `focus-visible:ring-[3px] ring-ring/50` + `border-ring` (Button default); keyboard-reachable after the five surface tabs (see a11y). |
| Pressed / active (dialog open) | `bg-accent text-foreground` while the dialog is open (mirror the open state with `data-[state=open]` from the `DialogTrigger`, or drive from React `open` state). Never the primary indicator bar (reserved for surfaces). |
| Disabled | not applicable — Settings is always available. |

### B. Dialog body states

**1. Loading (initial `getConfig` in flight).** Body shows three `Skeleton` rows (one per field) at input height (`h-9`), labels rendered statically. Footer Save is `disabled`. Brief — this is a local IPC `invoke`. `aria-busy` on the body region.

**2. Populated.** The common case. Each field renders its current effective value + source:
   - Slack Client ID Input prefilled with the effective id (if any), source badge to the right.
   - Atlassian Client ID likewise.
   - Atlassian Client Secret shows its status row (configured/not), no value.

**3. Empty / unset (per field).** Input is empty with a placeholder ("Not set — using built-in/.env default" is too long; use a terse placeholder like `Paste your Slack client ID`). Source badge reads **"Unset"** as muted `text-muted-foreground` plain text (not a badge — absence is not a source). No reset control (nothing to revert to; see field §3 below).

**4. Disabled.** Inputs are disabled while a Save is in flight (prevents edits mid-persist) and during initial load. `disabled:opacity-50 disabled:cursor-not-allowed` from the `Input` primitive.

**5. Error.** See Save feedback below.

### C. Text id field states (Slack / Atlassian Client ID)

The source badge to the right of the label communicates where the effective value comes from:

| `source` | Right-of-label cluster |
|----------|------------------------|
| `settings` | `Badge variant="secondary"` "Settings"  +  reset control (revert to env) |
| `env` | `Badge variant="outline"` "from .env"  +  (no reset — the field is empty in Settings; the value IS the env fallback) |
| `unset` | muted text "Unset"  +  (no reset) |

**Per-field reset ("revert to .env default") control:** a `Button variant="ghost" size="xs"` with a `RotateCcw` icon + label "Reset". Shown ONLY when `source === 'settings'` AND there is something to fall back to — i.e. it is meaningful to clear the Settings value. When there is no env fallback at all (clearing would make the field `unset`), the control still appears if `source === 'settings'` but its tooltip/label reads **"Clear"** (it unsets the field; effective becomes unset, the integration simply can't connect — that is a legal state per spec Edge Cases). When `source === 'env'` or `unset`, **there is nothing the user set in Settings to revert**, so the reset control is ABSENT (not disabled-and-greyed — absent, to avoid implying a hidden action). The field's helper line names the consequence only when relevant (see force-disconnect).

Editing the Input to a new value and leaving the field flips the pending source to `settings` on Save; the badge updates to "Settings" after the save round-trips the new `ClientConfigStatus`.

**Focus:** the `Input` primitive's `focus-visible:border-ring focus-visible:ring-ring/50` ring; no custom treatment.

### D. Secret field (write-only) states

The Atlassian Client Secret is never rendered. It is a status row + an entry affordance + a clear control. Three macro-states from `ClientConfigStatus.atlassian` (`secretConfigured`, `secretSource`):

| Macro-state | Status row (left) | Controls (right) |
|-------------|-------------------|------------------|
| **Configured (via Settings)** | `Check` `text-primary` + "Secret configured" + `Badge variant="secondary"` "Settings" | "Replace" toggles the entry input; "Clear" (`RotateCcw`/`X`) reverts to env/unset |
| **Configured (via .env)** | `Check` `text-primary` + "Secret configured" + `Badge variant="outline"` "from .env" | "Replace" toggles the entry input; **no Clear** (nothing set in Settings to clear; the value is the env fallback) |
| **Not configured** | muted dot/`–` + `text-muted-foreground` "Not configured" | "Set secret" toggles the entry input; no clear |

**Entry affordance:** an `Input type="password"` revealed inline when the user clicks "Set secret" / "Replace". Placeholder: `Enter new client secret`. It is empty on open (the UI never seeds it with the existing value — there is none to seed). A small caption beneath: "The secret is stored encrypted and never displayed again." A `Button variant="ghost" size="xs"` "Cancel" collapses the entry without changing anything. Because it is `type="password"`, the value is masked while typing; combined with the never-read-back contract, the secret never appears as plaintext anywhere in the renderer.

**Clear control:** for the "via Settings" state, a `Button variant="ghost" size="xs"` "Clear" with `RotateCcw` reverts the saved secret to the env fallback (or unset). This is the `settings.clearField({ field: 'atlassian.clientSecret' })` path. It does NOT reveal anything; it just flips the status to whatever the env produces after the round-trip.

**Never render the value, never an input prefilled with it, never a "show" toggle.** There is no reveal control because the renderer never holds the value.

### E. Save feedback states

The Save button (footer, `Button variant="default"`) and a feedback slot directly above the footer:

| State | Save button | Feedback slot |
|-------|-------------|---------------|
| **Idle / dirty** | enabled when there is a pending change; "Save". When nothing changed, Save is `disabled` (re-saving identical values is a no-op per FR-013, so we prevent it). | empty |
| **In progress** | `disabled`, shows `Loader2 animate-spin size-3.5` + "Saving…" (matches `ConnectForm`'s "Connecting…"). Inputs disabled. | empty |
| **Success** | back to "Save" (disabled again — no pending change). | transient inline `Check text-primary` + "Saved" caption, auto-dismisses after ~2s (or persists until next edit). If the save force-disconnected an integration, the success line adds: "Slack was signed out — reconnect from its panel." |
| **Error (generic)** | re-enabled "Save" (the user can retry). | `Alert variant="destructive"`: title "Couldn't save settings", description = the error message. |
| **Error (encryption unavailable)** | re-enabled "Save". | `Alert variant="destructive"`: title **"Can't store credentials securely"**, description: **"cosmos couldn't access your system's secure storage, so your credentials weren't saved. No changes were written. This can happen if the OS keychain is locked or unavailable — try again, or set the values via environment variables instead."** Non-alarming, explains the cause, states that nothing was written (mirrors `TokenStore.save()` refusing plaintext), offers the `.env` escape hatch. The `AlertTriangle` icon, not a red X. |

The encryption-unavailable message specifically avoids words like "failed/error/denied" in the title and reassures that nothing was persisted, so the user isn't alarmed into thinking they leaked or corrupted anything.

### F. Force-disconnect notice — RECOMMENDATION

**Recommendation: dual placement — a passive inline caption + an active confirm-on-Save.** Rationale: the consequence is destructive (signs the user out of a connected integration), and the spec calls it out as a real product behavior, so a silent save is wrong; but a always-on modal-on-modal would be heavy for the common case (changing an unconnected integration, or first-time setup where nothing is connected).

- **Passive inline caption (always, when a field is dirty AND its integration is currently connected):** beneath the changed field, a `text-muted-foreground` caption with `AlertTriangle size-3.5`: "Saving will sign out Slack — you'll need to reconnect." For Atlassian: "Saving will sign out Jira and Confluence — you'll need to reconnect." This makes the consequence legible at the point of change (the user sees it the moment they edit), per the spec's "make the consequence legible."
- **Active confirm-on-Save (only when the pending change WILL force-disconnect ≥1 connected integration):** clicking Save opens a small confirm `Alert` region inside the dialog footer area (NOT a second modal) — or, simplest and most consistent with the focus-trap, swap the footer into a confirm state: "This will sign out Slack. Save and sign out?" with `Button variant="destructive"` "Save & sign out" + `Button variant="ghost"` "Cancel". When no connected integration is affected (nothing connected, or no effective change), Save proceeds with no confirm.

Implementation note: whether an integration is "currently connected" is renderer state the dialog can derive (the panels already subscribe to `*:statusChanged`); if the dialog does not have that signal, fall back to **always** showing the passive caption for any dirty field and **always** confirming on Save when a credential changed. The confirm copy then reads conditionally. Either way, never disconnect without the user seeing the consequence first.

---

## Interaction & a11y

- **Gear accessible name:** the gear `Button` carries `aria-label="Settings"`, and the `TooltipContent` shows "Settings" on hover/focus (visual reinforcement, not the sole label).
- **Keyboard order in the rail:** the five surface `TabsTrigger`s form one Radix roving-tabindex group (arrow keys move between them, one Tab stop). The gear is OUTSIDE that group, so after the rail's single tab stop, the next `Tab` lands on the gear, then into the main surface. Arrow keys within the `TabsList` must NOT reach the gear (it is a plain Button, not a `TabsTrigger`, so Radix won't include it). `Enter`/`Space` on the gear opens the dialog.
- **Dialog focus trap + initial focus:** Radix `Dialog` traps focus within `DialogContent` while open. **Initial focus** goes to the first interactive control — the Slack Client ID `Input` (so a keyboard user lands ready to edit). If the populated state is "all configured and read-only-ish", initial focus may instead target the Save button; prefer the first input for the common edit case. Use `DialogContent`'s `onOpenFocus`/`autoFocus` default (first focusable) — acceptable since the first focusable is the Slack input.
- **Esc to close:** Radix `Dialog` closes on `Escape` and on overlay click by default. If a Save is in progress, prevent close (do not lose the in-flight write) — gate `onOpenChange`/`onEscapeKeyDown` while `saving`. If the confirm-on-Save state is showing, `Escape` cancels the confirm (returns to the edit state), not the whole dialog.
- **Close-without-save:** closing discards unsaved edits (they were never persisted). If there are unsaved edits, no warning in v1 (low-stakes; nothing is lost server-side and the user can reopen). Keep it simple; revisit only if user testing shows accidental loss.
- **Focus return:** on close, Radix returns focus to the gear `Button` (the trigger). Confirmed by `Dialog` default.
- **Label / description wiring for the write-only secret:** the secret entry `Input` gets `id="atlassian-client-secret"`, its `Label htmlFor="atlassian-client-secret"` reads "Atlassian Client Secret", and the "stored encrypted, never displayed again" caption is wired via `aria-describedby` so screen readers announce the write-only nature. The status row ("Secret configured" / "Not configured") is `aria-live="polite"` so a clear/replace announces the new status. The `Input` is `type="password"` (`aria-label` redundant with the `Label`).
- **Save feedback a11y:** the feedback slot (`Alert role="alert"` from the primitive) announces errors automatically; the success "Saved" caption is `aria-live="polite"`. The encryption-unavailable `Alert` is `role="alert"` (assertive) so it is announced immediately.
- **Source badges:** decorative reinforcement — the source is ALSO conveyed in text ("Settings" / "from .env" / "Unset" are the badge/label text themselves), so color is never the sole signal. Contrast: `secondary` badge `#dddddd` on `#3a3a3c` and `outline` `#e0e0e0` text on the popover both clear AA against the dark surface.
- **Reset/Clear controls:** each `Button` carries an explicit `aria-label` ("Reset Slack Client ID to .env default" / "Clear Atlassian client secret") since the visible label may be a terse "Reset"/"Clear" or icon-only at `size="xs"`. Prefer icon + text label so it's never icon-only.
- **Contrast on dark:** all body text is `--foreground #e0e0e0` or `--muted-foreground #888` on `--popover #252526` — captions at `#888` clear AA for the small-but-non-essential helper text; primary action text is `--primary-foreground #0b1622` on `--primary #4a9eff` (strong). Destructive `#f3b0b0` on popover is legible (it is a light foreground, by design).

---

## Open questions

- **"Currently connected" signal for the force-disconnect confirm:** does `SettingsDialog` have (or get passed) each integration's connection state so it can decide passive-caption + confirm precisely? If not, the spec'd fallback (always caption a dirty field, always confirm-on-Save when a credential changed) is correct but slightly more conservative. Not blocking — flagging so the developer wires the connection state in if cheaply available (the panels already hold it via `*:statusChanged`). Recommend: pass a small `connected: { slack: boolean; jira: boolean; confluence: boolean }` prop derived in `App.tsx`, or have the dialog subscribe to the three `onStatusChanged` itself.

No blocking design questions.
