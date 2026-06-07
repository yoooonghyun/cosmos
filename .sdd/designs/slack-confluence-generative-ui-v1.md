# Design: Slack + Confluence Generative UI — v1

**Status**: Draft
**Created**: 2026-06-06
**Spec**: `.sdd/specs/slack-confluence-generative-ui-v1.md`
**Plan**: `.sdd/plans/slack-confluence-generative-ui-v1.md`
**Owner**: designer

---

## 0. Summary & design-system verdict

This feature adds two per-panel A2UI custom catalogs (`catalogId: 'slack'`,
`catalogId: 'confluence'`) plus a bottom-docked `PromptComposer` to `SlackPanel` and
`ConfluencePanel`, mirroring the Jira generative panel exactly. The plan fixes every
component name + prop; the designer owns visuals + the five states only.

**No new token. No new shadcn component. No new variant.** The native Slack and
Confluence panels already render every surface this catalog needs (message rows,
channel rows, search-result rows, page detail, empty/error lines) in pure cosmos
tokens. The catalog components REUSE that exact visual language so the agent-composed
body is pixel-indistinguishable from the native browser body. The Notice block maps to
the existing `Alert` `default`/`destructive` variants (no `--status-*` needed — unlike
Jira, there is no success/write state here, only info/error). The composer is cloned
verbatim from `JiraPanel.tsx`'s `PromptComposer`.

> **Anti-fabrication is a content rule, not a visual one.** Every component renders only
> the static props the agent passes; the grounding prompt (FR-011) governs truthfulness.
> The designer's job is to make EMPTY and ERROR look intentional so a Notice/empty state
> never reads as a broken surface that tempts fabrication.

---

## 1. Shared foundations (both catalogs)

### 1.1 Palette / tokens used (the complete set — all pre-existing)

| Token | Use |
|-------|-----|
| `bg-card` / `text-card-foreground` | panel body + message/page body text |
| `bg-popover` | composer footer + (native) header strips |
| `text-foreground` | author names, channel names, titles (primary text) |
| `text-muted-foreground` | timestamps, metadata, counts, empty copy, placeholders |
| `border-border` / `border-border/60` | row separators, panel edges (`/60` = inter-row hairline, matches native) |
| `bg-accent` (`/40`) | row hover wash (matches native `ghost` button hover) |
| `bg-secondary` / `text-secondary-foreground` | `member` / count chips (`Badge variant="secondary"`) |
| `border-border` + `text-foreground` | context chips (`Badge variant="outline"` — `#channel`, space) |
| `bg-destructive/15` + `border-destructive/40` + `text-destructive` | error Notice, surface error boundary |
| `text-primary` | composer "Generating…" spinner accent only |
| `ring` (`outline-ring/50` base) | focus ring on every interactive element |

No `--status-*` token is consumed by either catalog (those are Jira-status-category
specific). No raw hex anywhere.

### 1.2 shadcn components used (all pre-existing in `components/ui/`)

`Card`, `Badge` (`secondary` / `outline` variants), `Avatar` + `AvatarFallback`,
`Alert` + `AlertDescription` + `AlertTitle` (`default` / `destructive`),
`ScrollArea`, `Button` (`link` / `ghost` for the native browser only), `Textarea`
(composer), plus the SDK `standardCatalog` `Column` / `Row` / `Text` passthroughs.
Helpers `initials()` + `formatTs()` already live in `atlassianPanelBits.tsx`
(Confluence ISO) and inline in `SlackPanel.tsx` (Slack epoch `ts`) — REUSE; the Slack
catalog needs the Slack-`ts` `formatTs`, so lift it to a shared spot or duplicate the
4-line helper (developer's call; no visual difference).

### 1.3 Catalog component contract (SDK injection)

Every catalog component receives `{ surfaceId, componentId, ...nodeProps }` (the SDK
`ComponentRenderer` spreads the surface node). Components read their STATIC props
directly — these are DISPLAY-only (no `useFormBinding` / `useDispatchAction`; there are
no inputs and no actions in v1, FR-012). An unlisted type name degrades to the SDK
`UnknownComponent` (warn, no throw); a render-time throw degrades to the panel's
`SurfaceErrorBoundary` (cloned from `JiraPanel`) — never a white screen (FR-007/SC-005).

### 1.4 The five states — where they live

Because these surfaces are agent-composed and read-only, the "states" split across two
layers. State ownership is explicit so the developer knows what to build where:

| State | Owner | Treatment |
|-------|-------|-----------|
| **loading** | the PANEL (not the catalog) — while the headless run is in flight | composer footer shows the `Loader2` "Generating…" spinner (§4); the prior surface (if any) stays visible; no skeleton in the body for v1 (no default-view read, FR-016) — idle body shows the §5 idle empty state |
| **empty** | the CATALOG list components | each list renders its own "nothing found" line when its array is empty (e.g. `ChannelList` → "No channels.") — agent emits the list with `[]`, never fabricated rows (FR-011) |
| **populated** | the CATALOG components | the row/list/detail visuals in §2/§3 |
| **error / not-connected** | the CATALOG `Notice` (agent-emitted, FR-011) for run-level read failures, AND the PANEL native Connect affordance for the not-connected panel gate (FR-015); the `SurfaceErrorBoundary` for malformed surfaces | `Notice noticeKind="error"` = destructive Alert; panel-gate = unchanged native ConnectForm |
| **disabled** | the composer (§4) while a run is in flight, and the whole composer when the panel is not connected (FR-015) | `Textarea disabled`, Send disabled, footer hint → spinner |

---

## 2. Slack catalog (`catalogId: 'slack'`) — `src/renderer/slackCatalog/`

All visuals lifted from `SlackPanel.tsx` (its `MessageRow`, `ChannelList` button rows,
`SearchResults` rows) so native and generative bodies match. Author name uses the
raw-id fallback `userName ?? userId` (the native `authorName()` helper).

### 2.1 `ChannelRow` — props `{ id, name, isMember }` (`SlackChannel`)

- **Visual**: a row matching the native channel button — `Hash` icon (`size-3.5
  text-muted-foreground`), channel name (`truncate text-foreground`), and, when
  `isMember`, a right-aligned `Badge variant="secondary"` reading `member`
  (`px-1.5 py-0 text-[10px]`). Container: `flex items-center gap-1.5 px-2 h-8 rounded-md`.
  Static display (no nav in v1) → render as a non-interactive `div`, NOT a `Button`
  (there is no drill-in target in a generative surface). Optional `hover:bg-accent/40`
  for visual parity, but no pointer affordance / no `onClick`.
- **States**: populated only (a single row). Empty/error handled by `ChannelList`/`Notice`.
- **a11y**: decorative `Hash` icon `aria-hidden`; name is the accessible text.

### 2.2 `ChannelList` — props `{ channels: ChannelRow-props[] }` (`SlackChannel[]`)

- **populated**: a count line `text-xs text-muted-foreground` `aria-live="polite"`
  ("N channels" / "1 channel" — mirrors `IssueList`), then a `flex flex-col` of
  `ChannelRow`s. No outer `ScrollArea` (the panel body scrolls — see §6).
- **empty** (`[]`): centered block — `Hash` glyph `size-7 text-muted-foreground` +
  "No channels." `text-sm text-muted-foreground`, `py-8` (mirrors `IssueList` empty).
- **a11y**: `key` by channel `id`.

### 2.3 `MessageRow` — props `{ ts, userId, userName?, text, replyCount? }` (`SlackMessage`)

- **Visual**: EXACT clone of the native `MessageRow`:
  `flex gap-2.5 border-b border-border/60 px-3 py-2 last:border-b-0`; `Avatar size="sm"
  mt-0.5` with `AvatarFallback` = `initials(name)`; header line = name
  (`truncate text-sm font-medium text-foreground`) + `formatTs(ts)`
  (`shrink-0 text-xs text-muted-foreground`); body = `text` in
  `whitespace-pre-wrap break-words text-sm text-card-foreground`.
- **reply count**: when `replyCount > 0`, render it as STATIC muted text
  `text-xs text-muted-foreground` ("N replies") — NOT the native `Button variant="link"`
  (there is no thread to open in a generative surface; keep it informational).
- **states**: populated only. Empty handled by `MessageList`.

### 2.4 `MessageList` — props `{ messages: MessageRow-props[] }` (`SlackMessage[]`)

- **populated**: `flex flex-col` of `MessageRow`s (no count line needed — messages read
  as a thread; matches native history which has none).
- **empty** (`[]`): the native `EmptyLine` pattern — `px-3 py-6 text-center text-sm
  text-muted-foreground` "No messages." (caller-agnostic copy; the agent may compose a
  `Text` label above to say which channel).
- **a11y**: `key` by `ts`.

### 2.5 `SearchResultRow` — props `{ ts, userId, userName?, text, channelId, channelName? }` (`SlackSearchMatch`)

- **Visual**: clone of the native search row — same row frame as `MessageRow`, but the
  header line carries the `#channel` context chip: name + (when `channelName`)
  `Badge variant="outline" px-1.5 py-0 text-[10px]` reading `#{channelName}` + a
  right-pushed `formatTs(ts)` (`ml-auto shrink-0 text-xs text-muted-foreground`). Body
  identical to `MessageRow`.
- **states**: populated only.

### 2.6 `SearchResultList` — props `{ matches: SearchResultRow-props[] }` (`SlackSearchMatch[]`)

- **populated**: count line `aria-live="polite"` ("N results" / "1 result"), then the
  rows (matches the native `SearchResults` header).
- **empty** (`[]`): `EmptyLine` "No results." (the agent supplies the query context via a
  preceding `Text` label).

### 2.7 `UserChip` — props `{ id, displayName }` (`SlackUser`)

- **Visual**: an inline person token mirroring Jira's `PersonInline` —
  `inline-flex items-center gap-1.5 text-xs text-muted-foreground`, `Avatar size="sm"`
  with `AvatarFallback` = `initials(displayName)`, then `displayName` (`truncate`). Used
  when the agent renders a user reference outside a message row (e.g. "messages from
  @alice"). Falls back to `id` if `displayName` is empty.
- **states**: populated only.

### 2.8 `Notice` — props `{ noticeKind: 'info' | 'error', message }`

- **Visual**: the FR-011 not-connected / read-error / empty fallback block.
  - `noticeKind="error"`: `Alert variant="destructive"
    className="border-destructive/40 bg-destructive/15"` with a `TriangleAlert` glyph
    and `AlertDescription className="text-destructive"` = `message`. (Same treatment as
    the native `ErrorState` Alert and Jira's error Notice.)
  - `noticeKind="info"`: `Alert variant="default"` (neutral `bg-card text-card-foreground`)
    with an `Info` glyph (`lucide-react`), `AlertDescription` = `message`. Used for
    "connect Slack in cosmos to load real data" and benign "nothing found" run-level
    messages.
- **a11y**: `Alert` already sets `role="alert"`; error Notices announce.

### 2.9 Passthroughs — `Column` / `Row` / `Text`

Register `Column` + `Row` from `standardCatalog` (layout roots / grouping) and a thin
cosmos `Text` IDENTICAL to Jira's (`variant: 'label' | 'body'`, `muted?`): `label` =
`text-xs font-medium text-muted-foreground`; `body` = `whitespace-pre-wrap break-words
text-sm leading-relaxed` (`text-card-foreground`, or `text-muted-foreground` when
`muted`). The render tool advertises these for grouping/headings (e.g. a "Channels"
label above a `ChannelList`).

---

## 3. Confluence catalog (`catalogId: 'confluence'`) — `src/renderer/confluenceCatalog/`

All visuals lifted from `ConfluencePanel.tsx` (`ContentList` rows, `PageDetail`).
Body/excerpt arrive pre-flattened plain text (per `src/shared/confluence.ts`).

### 3.1 `SearchResultRow` — props `{ id, title, space?, excerpt }` (`ConfluenceSearchResult`)

- **Visual**: clone of the native search row, as a STATIC card (no drill-in in a
  generative surface): container
  `flex flex-col items-start gap-1 border-b border-border/60 px-3 py-2 last:border-b-0`.
  Header line: `flex w-full items-center gap-2` → title
  (`min-w-0 flex-1 truncate text-sm font-medium text-foreground`) + (when `space`)
  `Badge variant="outline" ml-auto shrink-0 px-1.5 py-0 text-[10px]` = `space`. Below,
  when `excerpt`: `line-clamp-2 w-full text-xs text-muted-foreground`.
  Render as a `div` (not the native `Button`) — informational, no `onClick`. Optional
  `hover:bg-accent/40` for parity only.
- **states**: populated only.

### 3.2 `SearchResultList` — props `{ results: SearchResultRow-props[] }` (`ConfluenceSearchResult[]`)

- **populated**: count line `aria-live="polite"` ("N results"), then the rows (mirrors
  native `ContentList`).
- **empty** (`[]`): `EmptyLine` "No content matches." — same as native.

### 3.3 `PageDetail` — props `{ id, title, space?, body }` (`ConfluencePageDetail`)

- **Visual**: clone of native `PageDetail`: `flex flex-col gap-4 p-3` →
  a header block `flex flex-col gap-2` with title
  (`text-base font-medium leading-snug text-foreground`) and, when `space`, a
  `Badge variant="outline" px-1.5 py-0 text-[10px]` = `space`; then the body:
  - `body.trim() !== ''` → `whitespace-pre-wrap break-words text-sm leading-relaxed
    text-card-foreground`.
  - empty body → muted line "This page has no readable body." (`text-sm
    text-muted-foreground`) — the per-detail EMPTY state.
- **states**: populated + (empty body) handled inline as above. Page-not-found at the
  RUN level → the agent emits a `Notice` instead of `PageDetail` (FR-011).

### 3.4 `Notice` — props `{ noticeKind: 'info' | 'error', message }`

Identical to the Slack `Notice` (§2.8) — same `Alert` variants, glyphs, and copy
discipline. (Two files, one visual spec; the developer may share a tiny `Notice` helper
but each catalog registers its own per FR-004/FR-005.)

### 3.5 Passthroughs — `Column` / `Row` / `Text`

Same as §2.9.

---

## 4. PromptComposer (both panels) — verbatim reuse

Clone `JiraPanel.tsx`'s `PromptComposer` exactly (it itself clones `GeneratedUiPanel`):

- **Structure**: `<form class="shrink-0 border-t border-border bg-popover px-3 py-3">`
  → `Textarea` (`max-h-[9rem] min-h-[2.5rem] resize-none`) → optional error line →
  footer row (left: hint/spinner `text-[11px]`, right: `Button variant="default"
  size="sm"`).
- **Behavior** (unchanged): Enter submits, Shift+Enter newline, empty/whitespace is a
  no-op, submit ignored while `running` (the shared single-run guard), error line on
  `agent.onStatus` error.
- **DISABLED state**: while `running`, `Textarea` is `disabled`, Send is disabled and
  reads "Generating…" with `Loader2 animate-spin`, footer hint becomes the
  `text-primary` spinner. While the panel is NOT connected the composer is NOT rendered
  at all (the panel shows the native Connect affordance instead, FR-015) — equivalent to
  disabled, and stronger (no dead input to type into).
- **Only differences from Jira**: `submit()` threads `target: 'slack'` / `'confluence'`;
  placeholder + `aria-label` copy:
  - Slack: `"Ask about your Slack channels and messages…"` / "Ask about Slack".
  - Confluence: `"Ask about your Confluence pages…"` / "Ask about Confluence".

---

## 5. Panel composition & idle state

Each connected body mirrors `JiraPanel`'s `ConnectedBody` MINUS the per-switch
default-view read (FR-016 — no `requestDefaultView` analogue):

```
<section> (unchanged: tab-strip header + ConnectionBar)
  not connected → native ConnectForm (unchanged, FR-015)   ← panel gate
  connected →
    <div flex h-full flex-col>
      <div min-h-0 flex-1 overflow-auto p-3 text-card-foreground>   ← A2UI host
        <SurfaceErrorBoundary key={requestId}>
          <A2UIProvider catalog={slackCatalog|confluenceCatalog}>
            <SurfaceBridge target="slack"|"confluence" />
          </A2UIProvider>
        </SurfaceErrorBoundary>
      </div>
      <PromptComposer />   ← bottom-docked
```

- **Decision — keep the native browser, OR replace with idle prompt?** The plan
  (Phase 1/2 checklist) says the composer is **additive** and the existing native
  channel/search browser is **kept** ("do not remove existing read affordances"). So
  the connected body is the native browser PLUS the composer, and the A2UI host renders
  the agent surface in the SAME body region. **Recommended layout**: the A2UI surface,
  once composed, takes over the scrollable body (replacing the native browser view) so
  the user sees exactly what they asked for; before any utterance the native browser is
  the idle content. The composer is always docked at the bottom. This keeps the native
  read affordances reachable (idle/native view) while making the generative surface the
  focus after a run. *(Open question Q1 — confirm with developer; both readings satisfy
  FR-015/FR-016.)*
- **IDLE empty state** (connected, no surface yet, if the native browser is hidden):
  centered glyph (`MessageSquare` Slack / `BookText` Confluence) `size-8
  text-muted-foreground` + muted copy ("Ask a question to compose a Slack view." /
  "…Confluence view."). Reuses the native not-connected empty block's layout.
- The body scrolls (`overflow-auto`); catalog lists therefore do NOT each wrap in a
  `ScrollArea` (one scroll container, like Jira's body) — avoids nested scroll traps.

---

## 6. Interaction & accessibility

- **Focus order** (connected panel): tab-strip header (non-focusable) → ConnectionBar
  Disconnect → [native browser controls if shown] → composer `Textarea` → Send. The
  composed A2UI surface is display-only (no focusable controls in v1), so focus skips
  it.
- **Keyboard**: composer Enter / Shift+Enter only (no other keyboard paths added).
- **ARIA**:
  - Count lines `aria-live="polite"` so a re-composed list announces its new count.
  - `Notice` / error boundary inherit `role="alert"` from `Alert` (run-level read
    failures announce).
  - Composer footer status `role="status" aria-live="polite"` (from the Jira clone) so
    "Generating…" announces.
  - Decorative glyphs (`Hash`, avatars, list-empty icons) `aria-hidden`; text carries
    meaning.
- **Contrast** (dark `#1e1e1e`-family bg): `text-foreground` (#e0e0e0) and
  `text-card-foreground` clear AA on `card`/`background`; `text-muted-foreground`
  (#888) reserved for secondary metadata only (never the sole carrier of meaning);
  `text-destructive` (#f3b0b0) on `bg-destructive/15` is the established error pairing
  used across every native panel. `outline` Badges use `border-border` + `text-foreground`
  (legible chip). No new color introduced, so contrast is already validated by the
  native panels.

---

## 7. Tokens / components added

**None.** No theme token, no shadcn component, no variant was added. Every surface is
expressed in the pre-existing cosmos dark palette + the current `components/ui/` set +
the SDK `standardCatalog` passthroughs, matching `jiraCatalog` and the native
Slack/Confluence panels. The `--status-*` tokens are intentionally NOT used (no
status-category concept exists for Slack/Confluence).

---

## 8. Open questions

- **Q1 (layout, non-blocking)**: Does the composed A2UI surface REPLACE the native
  channel/search browser in the connected body, or render BELOW/ALONGSIDE it? §5
  recommends "replace on compose, native browser as idle"; both satisfy FR-015/FR-016.
  Confirm with the developer at interface time — it's a wiring choice, not a new visual,
  so it does not block the catalogs. (If "alongside," the idle empty state in §5 is
  unused.)
- No blocking visual unknowns. The Notice `info`/`error` kinds, all five states, and
  every component map cleanly onto existing tokens/components.
