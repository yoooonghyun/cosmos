/**
 * dataBearingSpec — a PURE, side-effect-free heuristic shared by main AND the MCP render-server
 * bundles for the bindings-first contract (bindings-first-generative-ui-v1 + its v2 enforcement).
 *
 * The teaching is bindings-first: every data-displaying generated container should declare a
 * binding so main can rewrite its data prop to a refreshable `{path}` and treat the agent's
 * literal rows as a first-paint seed. A surface that paints integration data but carries NO
 * `bindings` / `descriptor` is the directive's failure mode ("EVERY data surface must be
 * refreshable") — it renders, but un-refreshably AND a reload re-paints stale literal rows with
 * no refetch.
 *
 * This module lives in `src/shared/` (NOT `src/main/`) so it bundles cleanly into the four MCP
 * render-server rollup bundles, which run OUTSIDE Electron and may import only Node built-ins,
 * the MCP SDK, zod, and the pure shared modules. It is consumed in TWO places:
 *  - main's `UiBridge.onMessage` — emits a single DEV WARNING when an unbound data surface lands
 *    (warn-and-continue; FR-008/FR-009).
 *  - each `render_*_ui` MCP tool handler — REJECTS (MCP `isError`) an unbound data surface so the
 *    model resubmits with a binding per container, instead of silently rendering un-refreshably.
 *
 * The "data-bearing" prop set is derived from {@link LIST_SOURCE_DATA_PROP} (the single source of
 * truth for which prop a list reads its rows from — so this stays in sync as list sources are
 * added) plus a small fixed set of detail bind props the detail catalogs read a bound value from
 * (Jira `TicketCard`'s `issue`; Confluence `PageDetail`'s `title`/`space`/`body`).
 *
 * CONSERVATIVE / false-positive-free (FR-009): it errs toward NOT flagging. An unparseable /
 * oddly-shaped spec, an unknown component type, or a prop that does not match a known data-prop
 * name → not data-bearing → no warning / no rejection.
 */

import { LIST_SOURCE_DATA_PROP } from './adapter'

/**
 * The detail bind props the detail catalogs read a single bound value from
 * (jira-/confluence-generative-adapter). These never appear in {@link LIST_SOURCE_DATA_PROP}
 * (that map is list rows props), so they are listed here explicitly. A detail is treated as
 * data-bearing only when one of these carries a `{path}` binding — a literal scalar (a static
 * builder's title/body) is NOT data-bearing, keeping the heuristic conservative.
 */
const DETAIL_BIND_PROPS: readonly string[] = ['issue', 'title', 'space', 'body']

/** The list rows props — the VALUES of the registry map (issues/channels/messages/matches/results). */
const LIST_ROWS_PROPS: readonly string[] = Object.values(LIST_SOURCE_DATA_PROP)

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** True when a prop value is a `{path}` binding (mirrors the rebinder's shape check). */
function isPathBinding(value: unknown): value is { path: string } {
  return isObject(value) && typeof value.path === 'string'
}

/**
 * Whether a single component prop value counts as data-bearing: a LITERAL ARRAY (a list seed
 * the rebinder would seed) OR a `{path}` binding (a value the rebinder would rewrite). A
 * scalar literal or absent value does not count.
 */
function isDataBearingValue(value: unknown): boolean {
  return Array.isArray(value) || isPathBinding(value)
}

/**
 * The first data-bearing container's `id` (or `''` when the component carries no usable id),
 * or `null` when `spec` contains NO data-bearing container. Pure, synchronous, never throws.
 * An unparseable / oddly-shaped spec → `null`.
 *
 * A list container counts when its rows prop holds a literal array or a `{path}`; a detail
 * container counts only when a bound detail prop is a `{path}` (a literal scalar title/body is
 * a static surface, not refreshable data).
 *
 * Returned so the MCP enforcement message can name the offending container; callers that only
 * need the boolean use {@link specHasUnboundDataContainer}.
 */
export function firstUnboundDataContainerId(spec: unknown): string | null {
  if (!isObject(spec)) {
    return null
  }
  const components = (spec as { components?: unknown }).components
  if (!Array.isArray(components)) {
    return null
  }
  for (const component of components) {
    if (!isObject(component)) {
      continue
    }
    for (const prop of LIST_ROWS_PROPS) {
      if (prop in component && isDataBearingValue(component[prop])) {
        return typeof component.id === 'string' ? component.id : ''
      }
    }
    for (const prop of DETAIL_BIND_PROPS) {
      if (prop in component && isPathBinding(component[prop])) {
        return typeof component.id === 'string' ? component.id : ''
      }
    }
  }
  return null
}

/**
 * Heuristic predicate (FR-008/FR-009): does `spec` contain at least one container that paints
 * integration data (a known list rows prop or detail bind prop holding a literal array or a
 * `{path}`)? Pure, synchronous, never throws. An unparseable/oddly-shaped spec → false.
 *
 * Call ONLY when a frame has neither `bindings` nor `descriptor`; a `true` result means the
 * surface renders un-refreshably and a dev warning / enforcement rejection is warranted.
 */
export function specHasUnboundDataContainer(spec: unknown): boolean {
  return firstUnboundDataContainerId(spec) !== null
}

/* ------------------------------------------------------------------------- *
 * Bindings-first ENFORCEMENT (bindings-first-generative-ui-v1 v2)
 *
 * The tool-description reframe (taught) is INSUFFICIENT at runtime: `bindings` is optional
 * and the model skips it (it fetches broadly, splits client-side, renders LITERAL rows with no
 * binding). So each `render_*_ui` MCP tool handler REJECTS an unbound data surface — returns an
 * MCP tool error so the model self-corrects within the SAME run by resubmitting with a binding
 * per container — BEFORE relaying to the bridge.
 *
 * Do NOT reject: a purely static surface (no data container), or a call that already carries
 * `descriptor` or `bindings`.
 *
 * BOUNDED to avoid an infinite reject loop / hung run: the render-server process is long-lived
 * within ONE AgentRunner run (its BridgeClient persists), so the counter is held in-memory per
 * process. After {@link ENFORCEMENT_REJECT_CAP} rejections it FALLS BACK to rendering anyway
 * (the warn-and-render behavior) so the surface still appears.
 * ------------------------------------------------------------------------- */

/**
 * Max times one render-server process rejects an unbound data surface before falling back to
 * rendering it anyway (so a model that cannot produce a binding still gets a surface, never a
 * hung run). Two is enough for one self-correction round-trip.
 */
export const ENFORCEMENT_REJECT_CAP = 2

/** The outcome of {@link evaluateBindingsFirst}: render (allow), or reject with a message. */
export type BindingsFirstDecision =
  | { reject: false }
  | { reject: true; message: string }

/**
 * The non-secret inputs the enforcement check reads from one `render_*_ui` call: the validated
 * spec plus whether the call already declared a `descriptor` or `bindings`.
 */
export interface BindingsFirstInput {
  spec: unknown
  hasDescriptor: boolean
  hasBindings: boolean
}

/**
 * Decide whether a `render_*_ui` call should be REJECTED for the bindings-first contract. ALLOWS
 * when the call already carries `descriptor`/`bindings`, or when the spec has no data-bearing
 * container (a purely static surface). Otherwise REJECTS with an instructive, SECRET-FREE message
 * naming the offending container and showing the `{ dataSource, query }` binding shape.
 *
 * Pure — the CAP / attempt-counting is the caller's concern (see {@link BindingsFirstEnforcer}),
 * so this stays trivially testable.
 */
export function evaluateBindingsFirst(input: BindingsFirstInput): BindingsFirstDecision {
  if (input.hasDescriptor || input.hasBindings) {
    return { reject: false }
  }
  const containerId = firstUnboundDataContainerId(input.spec)
  if (containerId === null) {
    return { reject: false }
  }
  const named = containerId === '' ? 'A container' : `Container "${containerId}"`
  // The example query is generic + non-secret (a narrowed JQL); it never instructs a token.
  const message = [
    `${named} displays data but has no binding, so it cannot be refreshed and a reload would`,
    'repaint stale literal rows with no refetch. Resubmit this render call with a `bindings`',
    'entry PER data container, each carrying that container\'s OWN narrowed query — e.g. a kanban',
    'column { "componentId": "<id>", "descriptor": { "dataSource": "searchIssues", "query": {',
    '"jql": "project = CSMS AND status = \\"To Do\\"" } } }. Each container\'s identity is its',
    'query, not its rows: NEVER split one broad fetch into multiple containers without giving',
    'each its own narrowed-query binding. Keep your literal rows — they stay as the first-paint',
    'seed. `query` holds ONLY non-secret params (jql/channelId/pageId/query) — NEVER a token. For',
    'a SINGLE data container you may instead pass one surface-wide `descriptor`.'
  ].join(' ')
  return { reject: true, message }
}

/**
 * The stateful, per-process enforcement gate the four `render_*_ui` servers share. Holds the
 * in-memory rejection counter so the reject loop is BOUNDED: after {@link ENFORCEMENT_REJECT_CAP}
 * rejections it stops rejecting and the caller renders anyway (warn-and-render fallback). One
 * instance per render-server process (its lifetime == one AgentRunner run).
 */
export class BindingsFirstEnforcer {
  private rejections = 0

  constructor(private readonly cap: number = ENFORCEMENT_REJECT_CAP) {}

  /**
   * Evaluate one call. Returns a reject decision ONLY while under the cap; once the cap is hit it
   * returns `{ reject: false }` so the surface renders (the model could not produce a binding).
   * Counts a rejection each time it returns one.
   */
  evaluate(input: BindingsFirstInput): BindingsFirstDecision {
    const decision = evaluateBindingsFirst(input)
    if (!decision.reject) {
      return decision
    }
    if (this.rejections >= this.cap) {
      // Cap reached — fall back to rendering anyway so the surface still appears (no hung run).
      return { reject: false }
    }
    this.rejections += 1
    return decision
  }
}
