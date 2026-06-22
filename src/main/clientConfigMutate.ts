/**
 * Pure client-config mutation helpers (settings-oauth-clients-v1, FR-015). Extracted
 * from the Electron-bound `settings:save` / `settings:clearField` handlers so the
 * payload->config merge and the per-field clear are NODE-testable without Electron.
 *
 * Both helpers cover ALL logical clients (slack, atlassian, google). A missing client
 * here is the bug class that previously dropped Google's client id on save and on clear.
 * Empty-string fields are NOT special-cased here — the store's `sanitize` drops them at
 * persist time (an empty id ⇒ unset ⇒ env fallback). No value is ever logged.
 */

import type { ClientConfig } from './integrations/clientConfigStore'
import type { ClientConfigField, ClientConfigSavePayload } from '../shared/ipc'

/**
 * Merge a validated save payload OVER the current config (FR-015). Any subset of the
 * three clients may be present; a present client's fields shallow-merge onto the stored
 * ones (absent fields are left unchanged). Returns a fresh config — `current` is not
 * mutated.
 */
export function mergeClientConfigSave(
  current: ClientConfig,
  payload: ClientConfigSavePayload
): ClientConfig {
  const next: ClientConfig = { ...current }
  if (payload.slack) {
    next.slack = { ...next.slack, ...payload.slack }
  }
  if (payload.atlassian) {
    next.atlassian = { ...next.atlassian, ...payload.atlassian }
  }
  if (payload.google) {
    next.google = { ...next.google, ...payload.google }
  }
  return next
}

/**
 * Drop one stored field so it reverts to env (FR-015). Copies every client through
 * (slack, atlassian, google) so clearing one field never strips an unrelated client's
 * stored config; an emptied sub-object is pruned. Returns a fresh config.
 */
export function clearClientConfigField(current: ClientConfig, field: ClientConfigField): ClientConfig {
  const next: ClientConfig = {
    ...(current.slack ? { slack: { ...current.slack } } : {}),
    ...(current.atlassian ? { atlassian: { ...current.atlassian } } : {}),
    ...(current.google ? { google: { ...current.google } } : {})
  }
  if (field === 'slack.clientId' && next.slack) {
    delete next.slack.clientId
    if (Object.keys(next.slack).length === 0) delete next.slack
  } else if (field === 'atlassian.clientId' && next.atlassian) {
    delete next.atlassian.clientId
    if (Object.keys(next.atlassian).length === 0) delete next.atlassian
  } else if (field === 'atlassian.clientSecret' && next.atlassian) {
    delete next.atlassian.clientSecret
    if (Object.keys(next.atlassian).length === 0) delete next.atlassian
  } else if (field === 'google.clientId' && next.google) {
    delete next.google.clientId
    if (Object.keys(next.google).length === 0) delete next.google
  } else if (field === 'google.clientSecret' && next.google) {
    delete next.google.clientSecret
    if (Object.keys(next.google).length === 0) delete next.google
  }
  return next
}
