# Design: Slack Send Message — Composer + Reconnect Affordance — v1

**Status**: Draft
**Created**: 2026-06-20
**Spec**: .sdd/specs/slack-send-message-v1.md
**Plan**: .sdd/plans/slack-send-message-v1.md
**Owner**: designer

> Sits between Plan (Step 2) and Interface (Step 3). The plan fixed the *mechanism* (one
> `slack:sendMessage` IPC channel, `{ channelId, text, threadTs? } → SlackResult<{ ts }>`, a
> `canSend` capability flag on `SlackConnectionStatus`, confirmed re-read render). This spec fixes the
> *visual contract*: composer anatomy, its two homes, every state, keyboard/a11y — entirely in existing
> tokens + `components/ui/` primitives, dark-only. No new theme token, no new primitive.

---

## Grounding

> Direct investigation run for this design (mandatory). Queries actually executed:

**codegraph_explore / codegraph_search:**

- `SlackPanel SlackThreadPanel MessageList reconnect banner SlackConnectionStatus canSearch
  reconnect_needed history view thread dock` — returned the verbatim panel + manager. **Takeaways:**
  (1) `SlackManager.getStatus()` already emits a per-scope capability flag (`canSearch`) only in the
  `connected` state — `canSend` will mirror this exactly. (2) The history view is
  `view.kind==='history'` → `<MessageList>` inside `<div className="min-w-0 flex-1">`, itself the LEFT
  pane of the `@container/slackbody relative flex min-h-0 flex-1` two-pane (line ~1066). (3)
  `SlackThreadPanel` root is `flex h-full min-w-0 flex-col bg-card`; its body is the bordered-rail
  `min-h-0 flex-1 border-l-2 border-border/70 pl-1` wrapping the replies `MessageList` (line ~619).
  These two are the composer's two homes.
- Read `ReconnectState` (line 185), `ErrorState` (line 145), `ConnectForm`/`ConnectionStatus` (line
  257), `EmptyLine` (line 134). **Takeaway — the reconnect visual language to reuse verbatim:** a
  `<div className="p-3">` carrying `<Alert variant="destructive" className="border-destructive/40
  bg-destructive/15" role="alert">` with `<AlertTitle>Reconnect needed</AlertTitle>` +
  `<AlertDescription>` then a `<Button variant="default" size="sm" className="mt-2">Reconnect</Button>`.
  This is the same idiom Jira/Confluence use for "scope not granted → reconnect"; I reuse its exact
  classes so the missing-`chat:write` composer reads as the same product.
- `button.tsx` / `textarea.tsx` / `input.tsx` — **Takeaway:** `Textarea` already has
  `field-sizing-content min-h-16 w-full rounded-md border border-input bg-transparent dark:bg-input/30`
  with the shared focus ring (`focus-visible:border-ring focus-visible:ring-[3px]
  focus-visible:ring-ring/50`) and `disabled:` + `aria-invalid:` treatments. `Button` has
  `variant="default"|"ghost"`, `size="sm"|"icon-sm"`, built-in focus ring + `disabled:opacity-50`. Both
  composer pieces exist already — **no new primitive.**
- `index.css` — **Takeaway:** every token I reference exists in `.dark`: `--input` `#4a4a4c`, `--ring`
  `#4a4a4c`, `--primary` `#4a9eff`, `--card`/`--card-foreground` `#e0e0e0`, `--muted-foreground`
  `#888`, `--border` `#333`, `--destructive` `#f3b0b0`. **No raw hex, no new token.**

**memory_recall / memory_smart_search:**

- `Slack panel thread dock scope reconnect canSend design tokens` — empty store (no prior Slack-write
  design decision; `memory_recall` returned no results). Persisted this design's composer idiom +
  Enter-to-send decision via `memory_save` after authoring.

**Net:** the feature is fully expressible in existing tokens + `Textarea`/`Button`/`Alert` + a verbatim
reuse of the existing reconnect Alert idiom. **No new theme token, no new `components/ui/` primitive.**
The only net-new renderer artifact is one shared native `SlackComposer` component (a panel-chrome
sibling, not a catalog node) the developer builds; it consumes the system, it does not extend it.

---

## 1. The composer — one shared `SlackComposer` component

One component, mounted in two homes. It takes the resolved target (`channelId`, optional `threadTs`),
the `canSend` flag, and a `send` callback resolving `SlackResult<{ ts }>`; it owns its own draft text +
in-flight + error state locally. Identical visuals in both homes — only `placeholder` and width context
differ. This is the whole point: the channel composer and the thread reply composer must read as the
same control (mirrors how the thread dock reuses one `MessageList`).

### 1.1 Anatomy (the send-capable state)

A **footer bar pinned to the bottom** of its container, separated from the message list above by a
hairline so it never crowds the scroll region:

```
<div className="shrink-0 border-t border-border bg-card px-2 py-2">
  <form className="flex items-end gap-2" onSubmit={…}>
    <Textarea
      className="max-h-32 min-h-[2.25rem] flex-1 resize-none px-2.5 py-1.5 text-sm leading-snug"
      placeholder={threadTs ? 'Reply…' : `Message #${channelName}`}
      rows={1}
      value={text}
      aria-label={threadTs ? 'Reply to thread' : 'Message channel'}
      … />
    <Button type="submit" variant="default" size="icon-sm" aria-label="Send message"
            disabled={!canSubmit}>
      {sending ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
    </Button>
  </form>
  {/* inline error row — §3 */}
</div>
```

- **Container:** `shrink-0 border-t border-border bg-card` — sits below the `min-h-0 flex-1` message
  region as a sibling, so the list scrolls and the composer stays put. `bg-card` matches the panel
  body; the `border-t border-border` (#333) is the same hairline the panel uses everywhere.
- **Input:** the existing **`Textarea`** primitive (NOT `Input`), so a long message can wrap and the
  built-in `field-sizing-content` auto-grows. Pinned `rows={1}` start, `min-h-[2.25rem]` to match the
  `icon-sm` button height (`size-8` = 2rem; the `py` brings the field to ~2.25rem so they baseline-
  align via `items-end`), capped `max-h-32` then it scrolls internally — never pushing the list off
  screen in the narrow dock. `resize-none` (auto-grow owns sizing; no drag handle in a tight dock).
  Inherits the token border (`border-input` #4a4a4c), `dark:bg-input/30` fill, and the shared
  `focus-visible:ring-ring/50` ring — identical to every other field in cosmos.
- **Send affordance:** `Button variant="default" size="icon-sm"` with a `SendHorizontal` (lucide)
  glyph — compact, fits both the full-width channel footer and the ~18rem thread dock without a text
  label crowding it. `variant="default"` = `--primary` (#4a9eff) so the one actionable control reads as
  primary, consistent with `Connect`/`Reconnect`. `aria-label="Send message"` gives it an accessible
  name despite being icon-only. The Enter key is the primary path (§4); the button is the visible,
  pointer, and AT affordance.

`canSubmit = canSend && text.trim().length > 0 && !sending`.

---

## 2. The two homes (layout)

### 2.1 Channel-history footer

Mount `SlackComposer` as the **last child of the LEFT pane** that holds the history `MessageList`, so
it docks under the list and *inside* the `@container/slackbody` two-pane (it scopes to the channel
column, never spanning under the thread dock):

```
<div className="flex min-w-0 flex-1 flex-col">      ← make the history pane a column
  <div className="min-h-0 flex-1"> <MessageList … /> </div>
  {status.state === 'connected' && (
    <SlackComposer channelId={view.channel.id} canSend={status.canSend} placeholderName={view.channel.name} … />
  )}
</div>
```

- Only mounts in the `view.kind==='history'` case (a channel is selected). The `channels` list and
  `search` views have **no composer** (nothing to send *to*) — they keep their current full-height
  body. Switching channels remounts the composer (keyed by channel id) so a half-typed draft does not
  bleed across channels.
- The composer sits at full panel width here; the input gets ample room.

### 2.2 Thread-dock footer (reply composer)

Mount it as the **last child of `SlackThreadPanel`'s root column**, below the replies rail, so it pins
to the bottom of the dock in both layout modes:

```
<div className="flex h-full min-w-0 flex-col bg-card">
  <header … />            ← existing
  <div bg-muted/30> root row </div>
  <div replies divider />
  <div className="min-h-0 flex-1 border-l-2 border-border/70 pl-1"> <MessageList replies… /> </div>
  <SlackComposer channelId={context.channelId} threadTs={context.threadTs} canSend={canSend} … />  ← NEW
</div>
```

- The reply composer carries `threadTs` (the dock already owns `channelId` + `threadTs`), so a present
  `threadTs` makes the send a thread reply. Placeholder reads `Reply…`.
- **Narrow vs wide dock:** the dock is `w-[clamp(18rem,42%,28rem)]` side-by-side (≥32rem) or a
  `max-w-[22rem]` drawer below 32rem. The composer is `w-full` inside that column and needs **no
  breakpoint logic** — the icon-only send button + auto-grow textarea already fit ~18rem comfortably,
  and `min-w-0` on the column prevents overflow. The `max-h-32` cap is what protects the replies list
  from being squeezed when a long draft grows: the textarea scrolls internally instead of eating the
  `min-h-0 flex-1` replies region. In the drawer the composer + replies share the dock's full height,
  composer pinned to the bottom edge.

---

## 3. States

The composer holds local `text`, `sending`, and `error` state. Every state is a variation of the same
footer bar — never a layout jump.

| State | Treatment |
|-------|-----------|
| **Empty (no text)** | Textarea shows its `placeholder` in `--muted-foreground`. Send `Button` is **disabled** (`disabled:opacity-50`, `pointer-events-none`) — `canSubmit` false. No IPC issued. This is the resting state. |
| **Typing / has text** | Trimmed-non-empty text → send `Button` enabled (full `--primary`). Pressing Enter or clicking submits (§4). The textarea auto-grows up to `max-h-32`, then scrolls. |
| **Sending / in-flight** | On submit: `sending=true`. The send `Button` swaps its glyph for `<Loader2 className="size-4 animate-spin" />` and is **disabled** (blocks the double-submit, FR-012); the textarea gets `disabled` (greyed `opacity-50`, not cleared — text stays put until success). A second Enter is a no-op while `sending`. No separate spinner row; the button *is* the in-flight indicator (matches `ConnectForm`'s `Connecting…` idiom). |
| **Success** | On `result.ok`: clear `text` to `''`, drop any `error`, return focus to the (now empty, re-enabled) textarea so the user can keep typing (FR-013). Confirmed render: the parent re-reads the relevant view (history / thread replies) so the just-sent message appears via the existing read DTOs — the composer does not render the message itself. |
| **Failure — network / API / rate-limit / reconnect_needed** | `text` is **preserved**, textarea re-enabled, send re-enabled (retryable, FR-014). Show an **inline error row** directly above the form, *inside* the footer: `<p className="mb-1.5 flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/15 px-2 py-1 text-[12px] text-destructive" role="alert">` with a leading `AlertTriangle className="size-3.5"` + a calm, non-alarming message (e.g. `Couldn't send — try again.`; rate-limit → `Slack is busy — try again shortly.`; not-connected → `Not connected to Slack.`). This reuses the exact destructive-chip recipe the A2UI region already uses (`border-destructive/40 bg-destructive/15 text-destructive`), just one line tall to stay calm in a footer. The error clears on the next keystroke or successful retry. `reconnect_needed` additionally flips connection state upstream (FR-015), which transitions the composer to the missing-scope/reconnect treatment (§3 last row) on the next render. |
| **`canSend === false` — missing `chat:write` scope** | **Replace the input+send form** with the reconnect affordance (do NOT show an enabled-but-failing send). A compact reuse of the existing reconnect idiom, sized for a footer: `<div className="border-t border-border bg-card px-3 py-2.5">` → `<Alert variant="destructive" className="border-destructive/40 bg-destructive/15" role="alert"><AlertTitle>Reconnect to send</AlertTitle><AlertDescription>Sending a message needs a one-time reconnect to grant write access.</AlertDescription></Alert>` + `<Button type="button" variant="default" size="sm" className="mt-2" onClick={onReconnect}>Reconnect Slack</Button>`. Same classes as `ReconnectState`/`ConnectForm`'s reconnect Alert, so it is visually identical to the Jira/Confluence "scope not granted" pattern. On reconnect success (`canSend` flips true via the refreshed status) the form returns automatically — no further config. |
| **Disconnected (`not_connected` / `reconnect_needed` connection state)** | **No composer at all.** The composer only mounts when `status.state === 'connected'` (§2.1) — the panel's existing Connect / Reconnect CTA owns the whole body in those states, so there is nothing to compose into. (Mid-send `reconnect_needed` flips the connection state, which unmounts the composer and surfaces the panel-level reconnect — consistent with reads.) |

> **canSend vs connected:** `canSend` (the scope flag) only matters *within* the `connected` state. The
> matrix is: not connected → no composer (panel CTA); connected + `canSend===false` → reconnect-to-send
> footer; connected + `canSend===true` → the live composer (empty/typing/sending/error per above).

---

## 4. Keyboard, focus & a11y

- **Enter sends; Shift+Enter inserts a newline.** Decision + justification: this is a **chat composer**,
  and Enter-to-send is the universal chat convention (Slack itself, Discord, every IM) — users expect a
  single Enter to fire the message and reach for Shift+Enter for multi-line. Optimizing for the common
  case (short, single-line replies) over the rare multi-paragraph message is correct for a reply box.
  Implementation: `onKeyDown` — if `e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing`,
  `e.preventDefault()` and submit (guarded by `canSubmit`); otherwise let the newline through. The
  `isComposing` guard is **required** so IME composition (the panel already handles Korean/CJK
  elsewhere) does not send on the Enter that commits a composition.
- **Empty/whitespace Enter** is a no-op (same `canSubmit` guard as the button) — never an empty send.
- **Focus:** when a channel is opened or a thread dock opens, focus is **not** auto-stolen to the
  composer (the user may be reading); focus moves to the textarea only after a successful send (so a
  rapid back-and-forth flows). Tab order is natural DOM order: message list → textarea → send button.
  The send button is reachable and operable by keyboard (it is a real `<button type="submit">`; Enter
  inside the textarea also submits the form).
- **Accessible names:** the textarea carries `aria-label` (`Message channel` / `Reply to thread`) since
  there is no visible `<label>`; the icon-only send button carries `aria-label="Send message"`. The
  inline error row and the reconnect Alert both carry `role="alert"` so AT announces failures and the
  missing-scope notice.
- **Focus ring (dark):** both the textarea and the send button use the shared
  `focus-visible:ring-[3px] ring-ring/50` (token `--ring` #4a4a4c) — clearly visible against the
  `--card` #1b1b1c footer; same ring as every other cosmos control.
- **Contrast (dark-only):** input text `--card-foreground`/`--foreground` (#e0e0e0) and placeholder
  `--muted-foreground` (#888) on the `dark:bg-input/30` field; the primary send glyph is
  `--primary-foreground` on `--primary` (#4a9eff); the error chip is `--destructive` (#f3b0b0) on
  `bg-destructive/15` — all pairings the panel already passes with.
- **Reduced motion:** the only animation is the send button's `Loader2` spin; no layout transitions are
  added (the footer is static). Acceptable; matches the existing `Loader2` spinners.

---

## 5. Tokens & primitives ledger

- **New theme tokens:** none. Reuses `--card`, `--card-foreground`, `--foreground`, `--muted-foreground`,
  `--border`, `--input`, `--ring`, `--primary`, `--primary-foreground`, `--destructive`.
- **New `components/ui/` primitives:** none. Reuses `Textarea` (the composer input), `Button`
  (`variant="default" size="icon-sm"` send; `variant="default" size="sm"` reconnect), and `Alert`
  (`variant="destructive"` reconnect-to-send notice). Icons: `SendHorizontal`, `Loader2`, `AlertTriangle`
  (lucide — already the panel's icon source).
- **New renderer artifact (developer builds, not a design-system file):** one shared `SlackComposer`
  native component (draft/in-flight/error state + Enter-to-send keydown + the missing-scope branch),
  mounted in the history pane (§2.1) and `SlackThreadPanel` (§2.2). It consumes the system; it does not
  extend it. NOT added to the generative catalog or MCP surface (FR-016) — a native panel control only.

---

## 6. Open questions

- **None blocking.** All spec/plan OQ defaults are honored: confirmed (re-read) render, not optimistic;
  Enter-sends / Shift+Enter-newline chosen and justified (§4); the icon-only send button and footer
  placement reuse existing primitives at existing sizes. The exact failure-message copy per
  `SlackErrorKind` (incl. the final `write_not_authorized` kind name, pinned in the interface phase) can
  be finalized by the developer against the resolved kinds — the *treatment* (one-line calm destructive
  chip, text preserved, retryable) is fixed here regardless of wording.
