/**
 * Settings — OAuth client configuration boundary validators (FR-016/FR-017).
 * Spec: .sdd/specs/settings-oauth-clients-v1.md. Re-exported (unchanged) through
 * the `src/shared/validate.ts` barrel.
 *
 * Every inbound `settings:` IPC payload is validated here; an invalid/malformed
 * payload is warned and returned null so the handler IGNORES it — never crashes,
 * never overwrites good stored config (FR-016). NO secret is ever logged: the
 * Atlassian client_secret may ride in on a Save payload (write-only), so a warn
 * NEVER echoes the raw payload for the save validator — only the offending key name.
 */

import type {
  ClientConfigClearPayload,
  ClientConfigField,
  ClientConfigSavePayload
} from './settings'
import { defaultWarn, isObject, type WarnFn } from './common.validate'

/**
 * Validate a `settings:save` payload (settings-oauth-clients-v1, FR-015/FR-016).
 * Any subset is allowed (FR-015). Each PRESENT field must be a STRING (the empty
 * string is the valid "revert to env" sentinel for an id; absent ⇒ leave unchanged).
 * A non-object payload, a non-object `slack`/`atlassian`, or a non-string field is
 * warned and IGNORED (returns null) so a malformed save never overwrites good config
 * (FR-016). The returned payload carries ONLY the present, string-typed fields.
 *
 * SECURITY: the payload MAY contain the Atlassian client_secret (write-only,
 * R->M only), so this validator NEVER logs the raw payload — only the offending
 * STRUCTURE (a key name / type problem), never a value (FR-007).
 */
export function validateClientConfigSave(
  raw: unknown,
  warn: WarnFn = defaultWarn
): ClientConfigSavePayload | null {
  if (!isObject(raw)) {
    warn('[settings] ignoring settings:save — payload is not an object')
    return null
  }
  const out: ClientConfigSavePayload = {}

  if (raw.slack !== undefined) {
    if (!isObject(raw.slack)) {
      warn('[settings] ignoring settings:save — "slack" must be an object when present')
      return null
    }
    if (raw.slack.clientId !== undefined) {
      if (typeof raw.slack.clientId !== 'string') {
        warn('[settings] ignoring settings:save — "slack.clientId" must be a string when present')
        return null
      }
      out.slack = { clientId: raw.slack.clientId }
    } else {
      out.slack = {}
    }
  }

  if (raw.atlassian !== undefined) {
    if (!isObject(raw.atlassian)) {
      warn('[settings] ignoring settings:save — "atlassian" must be an object when present')
      return null
    }
    const atl: { clientId?: string; clientSecret?: string } = {}
    if (raw.atlassian.clientId !== undefined) {
      if (typeof raw.atlassian.clientId !== 'string') {
        warn('[settings] ignoring settings:save — "atlassian.clientId" must be a string when present')
        return null
      }
      atl.clientId = raw.atlassian.clientId
    }
    if (raw.atlassian.clientSecret !== undefined) {
      // NEVER log the secret value — only that the TYPE was wrong.
      if (typeof raw.atlassian.clientSecret !== 'string') {
        warn('[settings] ignoring settings:save — "atlassian.clientSecret" must be a string when present')
        return null
      }
      atl.clientSecret = raw.atlassian.clientSecret
    }
    out.atlassian = atl
  }

  if (raw.google !== undefined) {
    if (!isObject(raw.google)) {
      warn('[settings] ignoring settings:save — "google" must be an object when present')
      return null
    }
    const goog: { clientId?: string; clientSecret?: string } = {}
    if (raw.google.clientId !== undefined) {
      if (typeof raw.google.clientId !== 'string') {
        warn('[settings] ignoring settings:save — "google.clientId" must be a string when present')
        return null
      }
      goog.clientId = raw.google.clientId
    }
    if (raw.google.clientSecret !== undefined) {
      // NEVER log the secret value — only that the TYPE was wrong.
      if (typeof raw.google.clientSecret !== 'string') {
        warn('[settings] ignoring settings:save — "google.clientSecret" must be a string when present')
        return null
      }
      goog.clientSecret = raw.google.clientSecret
    }
    out.google = goog
  }

  return out
}

/** The clearable client-config fields (settings-oauth-clients-v1, FR-015). */
const CLIENT_CONFIG_FIELDS = new Set<ClientConfigField>([
  'slack.clientId',
  'atlassian.clientId',
  'atlassian.clientSecret',
  'google.clientId',
  'google.clientSecret'
])

/**
 * Validate a `settings:clearField` payload (settings-oauth-clients-v1, FR-015/FR-016).
 * Required: `field` is one of the three known clearable field names. A non-object, a
 * missing/non-string `field`, or an UNKNOWN field value is warned and IGNORED
 * (returns null) so a malformed clear never touches stored config (FR-016).
 */
export function validateClientConfigClear(
  raw: unknown,
  warn: WarnFn = defaultWarn
): ClientConfigClearPayload | null {
  if (!isObject(raw)) {
    warn('[settings] ignoring settings:clearField — payload is not an object:', raw)
    return null
  }
  if (typeof raw.field !== 'string' || !CLIENT_CONFIG_FIELDS.has(raw.field as ClientConfigField)) {
    warn('[settings] ignoring settings:clearField — "field" must be a known client-config field:', raw.field)
    return null
  }
  return { field: raw.field as ClientConfigField }
}
