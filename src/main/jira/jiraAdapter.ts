/**
 * jiraAdapter — the JIRA-SPECIFIC wiring for the shared generative adapter
 * (jira-generative-adapter-v1, FR-004/FR-008/FR-011). Two responsibilities, both
 * pure of Electron so they are node-testable:
 *
 *  1. `jiraAdapterResolver(manager)` — an {@link AdapterResolver} the shared
 *     {@link AdapterDispatcher} calls to re-execute a Jira descriptor. It maps the
 *     descriptor's `dataSource` (`searchIssues`|`getIssue`) to the real JiraManager
 *     read (token stays in main — FR-009/FR-021), and normalizes the result into the
 *     panel-agnostic {@link AdapterFetchResult} (items + nextCursor for a list, a
 *     single value for the detail, or an `ok:false` recoverable notice). The shared
 *     layer never parses a Jira DTO — only this resolver does.
 *
 *  2. The Jira BIND OPTIONS for each surface ({@link jiraListBindOptions} /
 *     {@link jiraDetailBindOptions}) the dispatcher registers a surface with — the
 *     bound list path + the pagination mode (append for the issue list per FR-020;
 *     none for the detail).
 *
 * The bound-surface COMPOSITION (the `{path}`/initial-data-model surface specs) lives
 * in `jiraSurfaceBuilder.ts`; this module owns only the read mapping + bind options.
 */

import type {
  AdapterFetchResult,
  AdapterRegisterOptions,
  AdapterResolver
} from '../generative/adapterDispatcher'
import type { AdapterDescriptor } from '../../shared/types/adapter'
import { JiraAdapterSource } from '../../shared/types/jira'
import { AdapterSourcePath } from '../../shared/types/adapter'
import type {
  JiraGetIssueParams,
  JiraIssueDetail,
  JiraIssueSummary,
  JiraPage,
  JiraResult,
  JiraSearchParams
} from '../../shared/types/jira'

/** The bound data-model path the issue list reads its rows from (FR-017). Single-sourced from
 * the shared {@link AdapterSourcePath} so the tool-description text + the dispatcher agree. */
export const JIRA_LIST_PATH = AdapterSourcePath.searchIssues
/** The bound data-model path the issue-detail reads its value from (single-sourced). */
export const JIRA_DETAIL_PATH = AdapterSourcePath.getIssue

/** Bind options for an issue-LIST surface: append/load-more pagination (FR-020). */
export const jiraListBindOptions: AdapterRegisterOptions = {
  listPath: JIRA_LIST_PATH,
  pagination: 'append'
}
/** Bind options for an issue-DETAIL surface: single value, no pagination (FR-020). */
export const jiraDetailBindOptions: AdapterRegisterOptions = {
  listPath: JIRA_DETAIL_PATH,
  pagination: 'none'
}

/**
 * Resolve the bind options a Jira descriptor's `dataSource` implies — the SAME
 * source-of-truth `resolveDescriptorShell` uses, exposed as a resolver for parity with
 * `slackBindOptionsForSource`/`confluenceBindOptionsForSource` so the shared
 * `resolveBindOptionsForSource` (refreshable-custom-generative-ui-v1, FR-002) can register
 * an agent's CUSTOM surface under its own surfaceId WITHOUT building a shell. Returns
 * `null` for a non-Jira/unknown source.
 */
export function jiraBindOptionsForSource(dataSource: string): AdapterRegisterOptions | null {
  switch (dataSource) {
    case JiraAdapterSource.SearchIssues:
      return jiraListBindOptions
    case JiraAdapterSource.GetIssue:
      return jiraDetailBindOptions
    default:
      return null
  }
}

/** The JiraManager subset the resolver needs (the two READS — never a write). */
export interface JiraAdapterManager {
  searchIssues(params: JiraSearchParams): Promise<JiraResult<JiraPage<JiraIssueSummary>>>
  getIssue(params: JiraGetIssueParams): Promise<JiraResult<JiraIssueDetail>>
}

/**
 * Map one issue summary to the bound row shape the `IssueList`/`TicketCard` catalog
 * components read (the SAME non-secret shape the static builder used). Kept here so
 * the resolver's row shape and the surface builder's seed shape never drift.
 */
export function jiraIssueRow(issue: JiraIssueSummary): Record<string, unknown> {
  return {
    issueKey: issue.key,
    summary: issue.summary,
    statusName: issue.statusName,
    statusCategory: issue.statusCategory,
    ...(issue.assignee ? { assignee: issue.assignee } : {})
  }
}

/**
 * Build the {@link AdapterResolver} for Jira. The dispatcher calls it with a
 * descriptor (the base query merged with the page cursor); this maps it to the
 * manager read and normalizes the result. A `reconnect_needed`/`not_connected`
 * failure is surfaced as a recoverable notice here too (the native Connect/Reconnect
 * still drives reconnection via `statusChanged`); the dispatcher renders the message
 * + clears loading, leaving prior data intact (FR-022). Never throws.
 */
export function jiraAdapterResolver(manager: JiraAdapterManager): AdapterResolver {
  return async (descriptor: AdapterDescriptor): Promise<AdapterFetchResult> => {
    if (descriptor.dataSource === JiraAdapterSource.SearchIssues) {
      const jql = typeof descriptor.query.jql === 'string' ? descriptor.query.jql : ''
      const params: JiraSearchParams = {
        jql,
        ...(descriptor.query.cursor ? { cursor: descriptor.query.cursor } : {})
      }
      const result = await manager.searchIssues(params)
      if (!result.ok) {
        return { ok: false, kind: result.kind, message: result.message }
      }
      return {
        ok: true,
        items: result.data.items.map(jiraIssueRow),
        ...(result.data.nextCursor ? { nextCursor: result.data.nextCursor } : {})
      }
    }

    if (descriptor.dataSource === JiraAdapterSource.GetIssue) {
      const issueKey = typeof descriptor.query.issueKey === 'string' ? descriptor.query.issueKey : ''
      const result = await manager.getIssue({ issueKey })
      if (!result.ok) {
        return { ok: false, kind: result.kind, message: result.message }
      }
      // A detail surface binds a single value (no list / cursors).
      return { ok: true, value: result.data }
    }

    // Unknown dataSource — recoverable, never a crash (FR-022).
    return { ok: false, kind: 'network', message: 'Unknown Jira data source.' }
  }
}
