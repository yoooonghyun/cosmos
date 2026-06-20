# Design: Settings Redesign — Tabbed Surface + Per-Integration Rail Gating — v1

**Status**: Draft
**Created**: 2026-06-20
**Spec**: .sdd/specs/settings-redesign-v1.md
**Plan**: .sdd/plans/settings-redesign-v1.md (Phase 0 — designer)
**Owner**: designer

---

## Grounding

**codegraph_explore / codegraph_search** (queries run → takeaways):
- `SettingsDialog settings modal integration connect disconnect OAuth client credentials` → the live `SettingsDialog.tsx` is ONE modal (`DialogContent max-w-[460px] gap-0 bg-popover p-0`) with three stacked `<section>` groups (Slack, **Atlassian = Jira+Confluence combined**, Google Calendar). It edits ONLY OAuth credentials (`IdField`, `SecretField`, `SourceBadge`, `GroupHeader`, `LoadingBody`, `FeedbackSlot`) — it has NO connect/disconnect. Save flows through `window.cosmos.settings.getConfig/save/clearField`; the dirty/force-disconnect/confirm machinery already exists and must be preserved.
- `App RAIL_ITEMS rail surface RailButton useConnectedStatus SurfaceId terminal generated-ui icon active settings gear` → the rail is a vertical `Tabs`/`TabsList variant="line"` (`w-12`, VS Code activity bar) over a STATIC `RAIL_ITEMS` 6-item array (terminal, generated-ui, slack, jira, confluence, google-calendar), all unconditionally mapped. Active highlight is driven from React state (`surface === id`), NOT `data-[state=active]` (Tooltip Slot clobbers `data-state`). The gear is a plain ghost `Button` pinned bottom by a `flex-1` spacer. `useConnectedStatus()` already tracks live `connected` per integration via `getStatus()` + `onStatusChanged`.
- `SlackPanel not_connected Connect ... reconnect-needed` → connection vocabulary is the manager state machine `not_connected | connecting | connected | reconnect_needed`; the panel renders its own not-connected/Connect prompt. "Connected" is fully independent of "in the rail."
- Component inventory (`src/renderer/components/ui/*.tsx`) → present: `tabs` (with `vertical` orientation + `line` variant), `button`, `dialog`, `input`, `label`, `badge`, `alert`, `skeleton`, `card`, `select`, `tooltip`, `scroll-area`. **Absent: `switch.tsx`** → must be added (see §3).

**memory_recall / memory_smart_search**:
- `settings dialog design tokens shadcn integration enable connect` → no prior stored design decision (empty). The standing system preference (MEMORY.md): cosmos UI = real Tailwind + shadcn design system, dark-first VS Code palette, tokens are the single source of truth. This design adds ONE primitive (`Switch`) and ZERO new tokens.

**Theme read** (`src/renderer/index.css`): full dark token set present (`--background #1e1e1e`, `--foreground #e0e0e0`, `--card #1b1b1c`, `--popover #252526`, `--primary #4a9eff`, `--secondary #3a3a3c`, `--muted #252526`, `--muted-foreground #888`, `--accent #2d2d30`, `--border #333`, `--input #4a4a4c`, `--ring #4a4a4c`, `--destructive #f3b0b0`). **No new tokens are needed for this feature.**

---

## 1. Scope & the one new primitive

This feature is fully expressible in the EXISTING design system plus **one** new shadcn primitive:

| Decision | Result |
|----------|--------|
| New tokens | **None.** Reuse `--popover`, `--card`, `--secondary`, `--primary`, `--muted-foreground`, `--border`, `--destructive`. |
| New `components/ui/` primitive | **`switch.tsx` MUST be added** (Radix Switch). `tabs.tsx` already exists and already supports `orientation="vertical"` — reuse it, no change. |
| Reused primitives | `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent`, `Dialog*`, `Button`, `Input`, `Label`, `Badge`, `Alert*`, `Skeleton`, `Tooltip*`. |
| Reused sub-components | `IdField`, `SecretField`, `SourceBadge`, `FeedbackSlot`, `LoadingBody` from the current `SettingsDialog.tsx` move verbatim into the per-integration tabs — their contract is unchanged (FR-011/FR-017). |

> **Handoff to developer (no Bash here):** run the shadcn CLI to add `switch`
> (`npx shadcn@latest add switch`) so it lands in `src/renderer/components/ui/switch.tsx`
> with the project's new-york style + `cn()` convention. The styling contract this design
> depends on is in §3 — if the generated file differs, reconcile it to §3.

---

## 2. The tabbed Settings layout

### 2.1 Form factor — keep it a Dialog, widen it, add a left tab-rail

Stay within the existing shadcn `Dialog` (the gear → modal mental model is unchanged and the spec leaves form factor to design, §"Settings surface form factor"). Two structural changes:

- **Widen** `DialogContent` from `max-w-[460px]` to **`max-w-[640px]`** and give it a fixed working height so the side-nav + content read as a stable two-pane surface (not a reflowing column). Keep `bg-popover p-0 gap-0` (the established Settings chrome).
- Replace the single scrolling `<section>` stack with a **two-pane body**: a vertical tab-rail on the left, the active tab's content on the right.

```
┌─ DialogContent (max-w-[640px], bg-popover) ───────────────────────┐
│  DialogHeader  "Settings"                            [x]          │  px-6 pt-6 pb-4
│  ────────────────────────────────────────────────────────────────│  border-b border-border
│  ┌── tab-rail (w-44) ──┐ │  ┌── tab content (flex-1) ───────────┐ │
│  │  General            │ │  │                                   │ │
│  │  ─────────────────  │ │  │   <one tab's body, scrolls>       │ │  max-h, overflow-y-auto
│  │  Slack          ●   │ │  │                                   │ │
│  │  Jira           ●   │ │  │                                   │ │
│  │  Confluence         │ │  │                                   │ │
│  │  Google Calendar    │ │  │                                   │ │
│  └─────────────────────┘ │  └───────────────────────────────────┘ │
│  ────────────────────────────────────────────────────────────────│  border-t border-border
│  DialogFooter   (shared save/confirm/close — unchanged machinery) │  px-6 py-3
└────────────────────────────────────────────────────────────────────┘
```

### 2.2 Vertical side-nav tabs — recommended, justified

**Recommendation: VERTICAL side-nav tabs (left rail), not horizontal top tabs.**

Justification:
1. **Five tabs (General + 4) with multi-word labels** ("Google Calendar", "Confluence") do not fit a 640px-wide horizontal strip without truncation or cramped wrapping. A vertical list gives every label its full, legible name at `text-sm`.
2. **Consistency with the product.** cosmos already uses a vertical `Tabs orientation="vertical"` rail as its primary navigation idiom (the activity bar in `App.tsx`). A vertical Settings nav reads as the same product — settings-as-a-mini-activity-bar — rather than introducing a second, conflicting tab affordance.
3. **Room to grow.** Future integrations append down the list with no horizontal-overflow problem (the rail just gets one more row), matching the spec's "adding a future integration is one key" intent.
4. **Per-tab status dot.** A vertical row has trailing space for a small connection-status dot (§4.4) next to each integration label — a quick at-a-glance "what's connected" without opening each tab. A horizontal strip has no room for this.

**Implementation:** reuse the existing `Tabs orientation="vertical"`. Use the **`line` variant** of `TabsList` (already in `tabs.tsx`) for a quiet, flat list (no filled pill per row) that matches the activity-bar treatment. The active row gets the same language the rail uses: `--secondary` fill + `--foreground` text + the 2px `--primary` left/right indicator the line variant already provides.

Tab-rail spec:
- `TabsList variant="line"`, `orientation="vertical"`, `className="w-44 shrink-0 flex-col items-stretch gap-0.5 border-r border-border bg-popover/40 p-2"`.
- Each `TabsTrigger`: full-width, left-aligned, `justify-start gap-2 px-2 h-8 text-sm`. Idle `text-muted-foreground`; hover `text-foreground`; active (driven by Radix `data-[state=active]` here — these triggers are NOT wrapped in a Tooltip, so unlike the rail the `data-state` is reliable) → `data-[state=active]:bg-secondary data-[state=active]:text-foreground`.
- Integration rows carry a leading brand icon (`SiSlack`/`SiJira`/`SiConfluence`/`SiGooglecalendar`, `size-4`) and a trailing **status dot** (§4.4). The General row carries a leading `Settings` (lucide) icon, no dot.

### 2.3 Tab set & order

`General · Slack · Jira · Confluence · Google Calendar` — General first (app-wide), then the four integrations in the same order as the rail. One `TabsContent` per tab; exactly one visible at a time (FR-001, SC-001). Default open tab = **General**. (Last-open tab is explicitly out of scope per spec.)

### 2.4 General tab

The General tab holds app-wide settings that are not integration-specific. For v1 its concrete content is light — it exists to (a) satisfy FR-001's "General tab" and (b) be the safe default landing tab that never depends on an integration being enabled. Content:
- A short orienting paragraph: "Integrations" heading + caption — "Turn integrations on to add their panel to the sidebar, then connect each from its own tab." This teaches the enable-vs-connect model up front.
- An **at-a-glance integration list** (read-only summary): each of the four integrations as a row showing its brand icon, name, an "In sidebar / Hidden" pill (mirrors `enabled`), and a connection status dot (§4.4). Rows are not interactive controls here (the toggle + connect live on each integration's own tab) — this is a dashboard so the user sees the whole picture without clicking through all four tabs. Each row is a quiet `Button variant="ghost"` that selects that integration's tab (cheap, optional convenience; if the developer prefers static rows that is acceptable).

This keeps General meaningful without inventing new app-wide settings the spec didn't ask for.

---

## 3. New primitive — `Switch` (`src/renderer/components/ui/switch.tsx`)

**Add the shadcn Radix `Switch`.** This is the right control for `enabled`: it is a binary, immediately-applied, persistent on/off state ("is this panel in my sidebar") — exactly switch semantics, and visually distinct from the `Button`-based Connect/Disconnect actions (§5), which is critical to keep Enable ≠ Connect un-confused.

Styling contract (the developer reconciles the generated file to this):
- Track: `h-5 w-9 rounded-full`. Off = `bg-input` (`#4a4a4c`, reads as a neutral dark track on `--popover`). On = `bg-primary` (`#4a9eff`) — the same primary the rail's active-indicator uses, so "on" speaks the product's active color.
- Thumb: `size-4 rounded-full bg-background shadow-sm`, translates `data-[state=checked]:translate-x-4`.
- Focus: `focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring` — identical focus ring to `Button`/`Input` so keyboard focus is uniform across the dialog.
- Disabled: `disabled:opacity-50 disabled:cursor-not-allowed` (used briefly during a save-in-flight if the developer chooses to lock controls; see §6).

> The `Switch` is general-purpose; once added it becomes the standard cosmos on/off
> control for any future boolean preference. Record it as the system's canonical toggle.

---

## 4. Per-integration tab anatomy

Every integration tab (Slack, Jira, Confluence, Google Calendar) follows the SAME vertical layout so all four read as one uniform template. Top-to-bottom:

```
┌─ tab content (px-6 py-5, space-y-5, overflow-y-auto) ──────────────┐
│  ① TAB HEADER                                                      │
│     [brand icon] Slack                                             │
│     Read channels and threads, post replies.        (caption)     │
│  ──────────────────────────────────────────────────────────────── │ border-b border-border
│  ② ENABLE ROW  (prominent, top)                                   │
│     ┌──────────────────────────────────────────────────────────┐  │
│     │  Show in sidebar                              [ ●——  ]    │  │  Switch, right-aligned
│     │  Adds the Slack icon to the left sidebar.                 │  │  sublabel
│     └──────────────────────────────────────────────────────────┘  │
│  ──────────────────────────────────────────────────────────────── │ border-b border-border
│  ③ CONNECTION                                                     │
│     Status: ● Connected                          [ Disconnect ]   │  status + action
│     (or: ○ Not connected                         [ Connect ]  )    │
│  ──────────────────────────────────────────────────────────────── │ border-b border-border
│  ④ CREDENTIALS                                                    │
│     Client ID            [from .env]                              │  reused IdField
│     [ input……………………………………………………… ]                              │
│     Client Secret        ✓ configured · Settings                 │  reused SecretField
│     [ Replace ] [ Clear ]                                         │
│     (Atlassian tabs: shared-credentials banner — see §7)          │
└────────────────────────────────────────────────────────────────────┘
```

### 4.1 ① Tab header
Reuses the existing `GroupHeader` pattern (brand icon `size-4` + `text-sm font-medium` title + `text-xs text-muted-foreground` caption). One per tab. This replaces the three stacked group headers of the old modal.

### 4.2 ② Enable row — the visual hierarchy that keeps Enable ≠ Connect

The Enable control is the FIRST interactive block, in a bordered emphasis row, so it reads as the tab's primary lever:
- Container: a single row, `flex items-center justify-between` inside a subtle `rounded-md border border-border bg-card/40 px-3 py-2.5`. The faint `--card` fill lifts it off the `--popover` dialog body so it's the first thing the eye lands on.
- **Label (primary):** `Show in sidebar` — `text-sm font-medium text-foreground`. (Per the architect's framing; "Show in sidebar" names the actual effect — gating the rail icon — better than a bare "Enable", and avoids colliding with "Connect".)
- **Sublabel:** `Adds the <Integration> icon to the left sidebar. You can enable without connecting.` — `text-xs text-muted-foreground`. The second sentence directly teaches the decoupling.
- **Control:** the `Switch` (§3), right-aligned, `aria-label="Show <Integration> in sidebar"`, with `htmlFor`/`id` wiring the visible label to the switch.

**Why this reads as distinct from Connect:** Enable is a *toggle* (Switch, primary `--primary` on-state, a state-of-being), Connect is an *action* (Button, a verb you click). Different control archetype, different section, different vocabulary ("Show in sidebar" vs "Connect"). They never share a row.

### 4.3 ③ Connection block

Mirrors the manager state machine (`not_connected | connecting | connected | reconnect_needed`) using the existing `window.cosmos.<int>.connect/disconnect` + the live `connected`/status already tracked. Layout: `flex items-center justify-between`.

Left — status, a dot + label (`text-sm`):
| State | Dot | Label | Token |
|-------|-----|-------|-------|
| connected | filled `●` | `Connected` *(+ account/team name as `text-muted-foreground` if available)* | `bg-primary` dot, `text-foreground` |
| not_connected | hollow `○` | `Not connected` | `border-muted-foreground` ring dot, `text-muted-foreground` |
| connecting | spinner | `Connecting…` | `Loader2 animate-spin size-3.5 text-primary` |
| reconnect_needed | filled `●` | `Reconnect needed` | `bg-destructive` dot, `text-destructive` |

Right — the action `Button`:
- not_connected / reconnect_needed → `Button size="sm"` default variant → **Connect** (reconnect_needed label = **Reconnect**).
- connected → `Button size="sm" variant="outline"` → **Disconnect**.
- connecting → `Button size="sm" disabled` with `Loader2` → **Connecting…** (the action is in flight; the button reflects it).

This block is the panel's connect flow surfaced in Settings (the spec/plan say reuse the existing API, do not add a parallel path — this block CALLS `window.cosmos.<int>.connect/disconnect`, it does not reimplement them).

### 4.4 Status dot (shared atom — tab-rail + General summary + connection block)

Define ONE small status-dot atom reused in three places (the side-nav rows §2.2, the General summary §2.4, the connection block §4.3) so "connected-ness" looks identical everywhere:
- `size-1.5 rounded-full` dot. connected → `bg-primary`; not_connected → `border border-muted-foreground bg-transparent`; reconnect_needed → `bg-destructive`; connecting → omit dot / show a tiny `Loader2`.
- In the side-nav row the dot is trailing and only shown for **enabled** integrations (a disabled integration shows no dot — it's not in play). For a disabled integration the row label is dimmed one notch (`text-muted-foreground` even when not active) to signal "not in sidebar."

### 4.5 ④ Credentials block

Verbatim reuse of `IdField` + `SecretField` + `SourceBadge` and their `settings.save`/`clearField` wiring (FR-011/FR-017/SC-010). Placement:
- **Slack tab:** Slack Client ID (`IdField`) only.
- **Jira tab & Confluence tab:** the shared Atlassian Client ID (`IdField`) + Client Secret (`SecretField`), under the shared-credentials banner (§7).
- **Google Calendar tab:** Google Client ID (`IdField`) + Client Secret (`SecretField`).

The existing dirty-field consequence captions ("Saving will sign out … reconnect") stay, now scoped per tab.

---

## 5. Enable vs Connect — the disambiguation rules (summary)

| | Enable | Connect |
|---|---|---|
| Control | `Switch` (toggle) | `Button` (action) |
| Section | ② (top, bordered emphasis) | ③ (below) |
| Label | "Show in sidebar" | "Connect" / "Disconnect" / "Reconnect" |
| On-state color | `--primary` track | n/a (it's an action) |
| Persistence | session snapshot `enabled` | OAuth token (encrypted, main) |
| Applies | immediately, no Save (live rail update) | on click, runs OAuth |

They are never on the same row, never the same control type, never the same verb.

---

## 6. States — every surface

### 6.1 Whole dialog
- **Loading:** on open, while `settings.getConfig()` resolves, the tab CONTENT shows the existing `LoadingBody` skeleton; the tab-rail renders immediately (its labels are static). `aria-busy` on the content region.
- **Saving (credentials):** unchanged from settings-oauth-clients-v1 — `FeedbackSlot` + footer `Saving…` + the force-disconnect confirm `Alert`. Esc/overlay close blocked mid-save (existing behavior preserved).
- **Save error / encryption-unavailable:** unchanged `Alert variant="destructive"` in `FeedbackSlot`.

### 6.2 Per integration tab — connection × enable matrix
| enabled | connection | Enable switch | Connection block | Rail effect |
|---|---|---|---|---|
| off | (any) | OFF | shows real status + Connect/Disconnect (still operable — you may connect before enabling) | icon hidden |
| on | not_connected | ON | `○ Not connected` + **Connect**; opening the panel shows its existing not-connected prompt | icon shown |
| on | connecting | ON | `Connecting…` spinner + disabled button | icon shown |
| on | connected | ON | `● Connected` + **Disconnect** | icon shown |
| on | reconnect_needed | ON | `● Reconnect needed` (destructive) + **Reconnect** | icon shown |

Note the **enabled-off but connected** cell is legal (disable kept the token, FR-009): the tab honestly shows `● Connected` with the switch OFF. Toggling back ON immediately re-shows the icon, still connected (SC-006).

### 6.3 Empty / first-run
Fresh install: all four Enable switches OFF, all connection blocks show their true status (likely `Not connected`). The General tab's summary list shows four "Hidden" rows. Nothing reads as broken — see §8 for the rail.

### 6.4 Disabled controls
- A `Switch` is never disabled by `enabled` itself (it's the thing you toggle). It MAY be briefly `disabled` while a credential save is in flight if the developer locks the whole content region (optional; the existing pattern only locks credential inputs — keeping the Switch live is also fine since enable writes go through a different path).
- The Connect button is `disabled` while `connecting` (it shows `Connecting…`).

---

## 7. Shared Atlassian credentials across Jira + Confluence

The Atlassian Client ID/Secret appear on BOTH the Jira and Confluence tabs and mutate the ONE shared client (FR-012). To make "shared, not duplicated" unmistakable, the credentials block on each of these two tabs is preceded by a **shared-credentials banner**:

- An `Alert` (default, non-destructive) with a `Link2`/`Share2` (lucide) icon:
  - **AlertTitle:** `Shared Atlassian credentials`
  - **AlertDescription:** *(on the Jira tab)* "Jira and Confluence use one Atlassian OAuth client. Editing these fields here also affects Confluence — saving a change signs out both, and you'll reconnect each from its own tab." *(Confluence tab swaps the two product names.)*
- Style the banner quietly: `bg-muted/40 border-border text-muted-foreground` (informational, not a warning) so it informs without alarming. The existing per-field "Saving will sign out Jira and Confluence" consequence caption still fires on a dirty edit (that's the warning; this banner is the standing context).
- The connection block (§4.3) on each tab stays INDEPENDENT: the Jira tab's status reflects Jira's connection only, Confluence's reflects Confluence's only (FR-013/SC-008) — even though the credentials below are shared. The banner explicitly scopes its claim to *credentials*, never to connection state, so the user isn't told the connections are linked (they aren't).

This is the key honesty: **credentials shared (banner says so), connections independent (two separate status dots/buttons).**

---

## 8. The dynamic left rail

The rail (`App.tsx`) changes from mapping the static `RAIL_ITEMS` to: always-present items (`terminal`, `generated-ui`) + gateable items filtered on `enabled`. Visual spec:

### 8.1 First-run / all integrations off (minimal rail)
Only **Terminal** + **Generated UI** icons, top-aligned, with the Settings gear pinned bottom by the existing `flex-1` spacer. This is a deliberately clean rail, not an error:
- No placeholder, no "add integrations" ghost slot, no empty-state text. Two real icons + the gear reads as intentional (it mirrors a fresh VS Code activity bar with few extensions). The spec's "does not read as broken" bar is met because the always-present panels are fully functional and the gear is the obvious discovery path.
- Optional gentle affordance (nice-to-have, not required): the FIRST time the rail is minimal, the Settings gear MAY carry a one-time subtle `--primary` dot to hint "set up integrations here." If implemented it must be dismiss-on-open and never nag. If in doubt, omit — the clean rail is acceptable on its own.

### 8.2 Fully enabled rail
Terminal, Generated UI, then Slack, Jira, Confluence, Google Calendar (rail order preserved), gear at bottom. Identical to today's static rail.

### 8.3 Transition (enable/disable live)
- Enabling adds the icon at its fixed position in the rail order (not appended at the end) so the rail's spatial layout is stable across toggles — Jira always sits where Jira sits. Icons fade in via the existing Tabs mount (no bespoke animation required; a `data-[state]` fade is acceptable if trivial, but not mandated).
- Disabling removes the icon. The remaining icons re-flow up; because order is fixed this is a single icon disappearing, not a reshuffle.

### 8.4 Active panel gets disabled → focus falls to Terminal
When the user disables the integration whose panel is currently the active `surface`, set `surface = 'terminal'` (FR-014/SC-007). Visually: the main area swaps to the Terminal, the Terminal rail icon takes the active treatment (`--secondary` pill + `--primary` left bar), and the just-disabled icon vanishes from the rail in the same frame. No blank surface, no flash of a hidden panel. (Fallback if Terminal were ever absent: first remaining enabled rail item — Terminal is always present, so this is defensive only.)

### 8.5 Keyboard cycle over the dynamic set
`Cmd+Shift+[` / `]` must cycle over the CURRENTLY VISIBLE rail items only (the filtered set), not the static array — so a hidden integration is never reachable by keyboard. The developer recomputes the cycle index against the visible list. (Behavioral note for the developer; not a visual change.)

---

## 9. Interaction & accessibility

- **Tab nav (side-rail):** Radix `Tabs` gives roving-tabindex + arrow-key movement between tabs and `Tab` into the active panel's content — free, correct, and the same a11y the rail already relies on. `aria-label="Settings sections"` on the `TabsList`.
- **Switch:** Radix `Switch` is a labelled `role="switch"` with `aria-checked`; wire the visible "Show in sidebar" label via `htmlFor`/`id`. Space/Enter toggles. Toggling announces through the control's state; the live rail change is the visible confirmation.
- **Connection block:** wrap the status text in `aria-live="polite"` so a state change (connecting → connected, or reconnect_needed) is announced. The action button's label IS the state ("Connect"/"Disconnect"/"Connecting…"/"Reconnect"), so it's self-describing.
- **Focus order per tab:** ① header (non-focusable) → ② Enable switch → ③ Connect/Disconnect button → ④ Client ID input → secret entry/replace/clear → footer Save/Close. Top-to-bottom matches visual order.
- **Contrast (dark palette):** all text pairs are existing, already-verified token pairs — `--foreground #e0e0e0` on `--popover #252526` (high), `--muted-foreground #888` for sublabels/captions (sufficient for secondary text), `--primary #4a9eff` switch-on and dots against `--popover` (clear), `--destructive #f3b0b0` reconnect text (legible). No new color pairings are introduced, so no new contrast risk.
- **Esc / close:** preserve the existing rule — Esc closes the dialog except mid-save (blocked) and mid-confirm (cancels the confirm first). Switching tabs does NOT discard pending credential drafts within the open dialog session (drafts persist across tab switches until Save/Close); the existing reset-on-open still clears them on the next open.
- **Reduced motion:** any icon fade-in/out on the rail must respect `prefers-reduced-motion` (instant show/hide), consistent with the project's existing reduced-motion discipline.

---

## 10. Tokens used (all existing — none added)

| Token | Use |
|-------|-----|
| `--popover` | dialog body, tab-rail bg |
| `--card` (at low alpha) | Enable-row emphasis fill |
| `--secondary` | active tab-row fill |
| `--primary` | Switch on-state, connected dot, rail active indicator |
| `--muted` / `--muted-foreground` | shared-credentials banner, captions, sublabels, not-connected text |
| `--destructive` | reconnect-needed dot + text |
| `--border` | tab-rail divider, section dividers, Enable-row border |
| `--input` | Switch off-track, input borders |
| `--ring` | focus rings (Switch, Tabs, Button, Input — uniform) |

---

## 11. Components used

| Component | Variant / size | Where | Status |
|-----------|----------------|-------|--------|
| `Dialog*` | `max-w-[640px]` | shell | existing (widen only) |
| `Tabs` `orientation="vertical"` | `TabsList variant="line"` | side-nav | existing — reused |
| **`Switch`** | default | Enable row, each integration tab | **ADD `src/renderer/components/ui/switch.tsx`** |
| `Button` | `size="sm"` default = Connect/Reconnect; `size="sm" variant="outline"` = Disconnect | connection block | existing |
| `Button` | `variant="ghost"` | General summary rows (optional) | existing |
| `Input` (`IdField`) | `h-9` | credentials | existing — reused verbatim |
| `SecretField` / `SourceBadge` | — | credentials | existing — reused verbatim |
| `Label` | — | Enable + fields | existing |
| `Badge` | `secondary` / `outline` | credential source | existing |
| `Alert*` | default (shared-creds banner); `destructive` (save error) | tabs / feedback | existing |
| `Skeleton` (`LoadingBody`) | — | tab loading | existing |
| `Tooltip*` | — | rail (unchanged) | existing |
| status-dot atom | new tiny internal helper (not a `ui/` primitive) | rail rows, General summary, connection block | new local helper |

---

## 12. Handoff checklist (developer)

1. **Add `Switch`:** run `npx shadcn@latest add switch` → `src/renderer/components/ui/switch.tsx`; reconcile to §3's styling contract (off `bg-input`, on `bg-primary`, `--ring` focus). This is the only new `ui/` primitive.
2. **No token changes** — `index.css` is untouched by this feature.
3. **Widen `DialogContent`** to `max-w-[640px]` + fixed working height; convert the body to the §2.1 two-pane (vertical `Tabs` side-nav + scrolling content).
4. **Relocate** `IdField`/`SecretField`/`SourceBadge`/`GroupHeader`/`LoadingBody`/`FeedbackSlot` into the per-integration tabs unchanged; wire `settings.save`/`clearField` exactly as today (FR-017).
5. **Connection block** calls existing `window.cosmos.<int>.connect/disconnect` + reads existing `connected`/`getStatus` — do NOT add a parallel connect path.
6. **Enable Switch** writes the new `enabled` flag through the existing `session.save` path (per plan D2 — no new IPC channel, no preload change).
7. **Rail** in `App.tsx`: filter gateable items on `enabled`, keep fixed order, re-focus to `terminal` on disable-of-active, recompute the keyboard cycle over the visible set.
8. Define ONE status-dot helper (§4.4) and reuse it in all three places.

---

## 13. Open questions

- **None blocking.** Two minor presentation choices left to the developer's discretion, both with a recommended default:
  - General-tab summary rows interactive (ghost-button → jump to tab) vs static — recommend interactive, but static is acceptable.
  - One-time "set up integrations" hint dot on the gear when the rail is minimal (§8.1) — recommend OMIT for v1 (the clean rail stands on its own); implement only if trivial and dismiss-on-open.
