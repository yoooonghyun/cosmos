/**
 * Pure resolver merging saved Settings client config OVER the environment defaults
 * (settings-oauth-clients-v1, FR-009/FR-010/FR-014). Node-testable: no Electron, no
 * `process.env` capture — the env is passed in as a plain reader so the merge order
 * is unit-testable and deterministic.
 *
 * Settings WIN; env is the fallback (FR-009). The managers' connect/refresh closures
 * read effective creds through {@link resolveEffective} at call time, so a save takes
 * effect WITHOUT a restart (FR-010/FR-011). {@link toStatus} produces the ONLY shape
 * that crosses to the renderer — it NEVER includes the Atlassian client_secret value,
 * only a `secretConfigured` boolean + its source (FR-007, SC-006). {@link diffEffective}
 * tells the save handler which logical clients' effective creds CHANGED so it can
 * force-disconnect exactly the affected integrations (FR-012/FR-013).
 */

import type { ClientConfig } from './integrations/clientConfigStore'
import type { ClientConfigSource, ClientConfigStatus } from '../shared/ipc'

/** The env vars this resolver reads as the fallback (FR-009). */
export interface ClientConfigEnv {
  COSMOS_SLACK_CLIENT_ID?: string
  COSMOS_ATLASSIAN_CLIENT_ID?: string
  COSMOS_ATLASSIAN_CLIENT_SECRET?: string
  COSMOS_GOOGLE_CLIENT_ID?: string
  COSMOS_GOOGLE_CLIENT_SECRET?: string
}

/**
 * The EFFECTIVE client credentials (Settings ?? env). `null` for any field that is
 * neither saved nor in env (the integration cannot connect — a legal state). The
 * managers consume `slackClientId` / `atlassianClientId` / `atlassianClientSecret`.
 */
export interface EffectiveClientConfig {
  slackClientId: string | null
  atlassianClientId: string | null
  atlassianClientSecret: string | null
  googleClientId: string | null
  googleClientSecret: string | null
}

/** Settings value when set, else the env fallback, else null (unset). */
function pick(settingsValue: string | undefined, envValue: string | undefined): string | null {
  if (settingsValue !== undefined && settingsValue.length > 0) {
    return settingsValue
  }
  if (envValue !== undefined && envValue.length > 0) {
    return envValue
  }
  return null
}

/** Where a resolved value came from (FR-014): saved-in-Settings, from-env, or unset. */
function sourceOf(settingsValue: string | undefined, envValue: string | undefined): ClientConfigSource {
  if (settingsValue !== undefined && settingsValue.length > 0) {
    return 'settings'
  }
  if (envValue !== undefined && envValue.length > 0) {
    return 'env'
  }
  return 'unset'
}

/**
 * Compute the effective client credentials (Settings-over-env, FR-009). Consumed by
 * the managers' connect/refresh closures (FR-010) so a saved value takes effect with
 * no restart (FR-011).
 */
export function resolveEffective(stored: ClientConfig, env: ClientConfigEnv): EffectiveClientConfig {
  return {
    slackClientId: pick(stored.slack?.clientId, env.COSMOS_SLACK_CLIENT_ID),
    atlassianClientId: pick(stored.atlassian?.clientId, env.COSMOS_ATLASSIAN_CLIENT_ID),
    atlassianClientSecret: pick(stored.atlassian?.clientSecret, env.COSMOS_ATLASSIAN_CLIENT_SECRET),
    googleClientId: pick(stored.google?.clientId, env.COSMOS_GOOGLE_CLIENT_ID),
    googleClientSecret: pick(stored.google?.clientSecret, env.COSMOS_GOOGLE_CLIENT_SECRET)
  }
}

/**
 * Build the renderer-safe status (FR-014). The ONLY shape that crosses to the
 * renderer: each id's effective value + source, and for the secret a `configured`
 * boolean + source — NEVER the secret value (FR-007, SC-006).
 */
export function toStatus(stored: ClientConfig, env: ClientConfigEnv): ClientConfigStatus {
  const eff = resolveEffective(stored, env)
  return {
    slack: {
      clientId: eff.slackClientId,
      source: sourceOf(stored.slack?.clientId, env.COSMOS_SLACK_CLIENT_ID)
    },
    atlassian: {
      clientId: eff.atlassianClientId,
      clientIdSource: sourceOf(stored.atlassian?.clientId, env.COSMOS_ATLASSIAN_CLIENT_ID),
      secretConfigured: eff.atlassianClientSecret !== null,
      secretSource: sourceOf(stored.atlassian?.clientSecret, env.COSMOS_ATLASSIAN_CLIENT_SECRET)
    },
    google: {
      clientId: eff.googleClientId,
      clientIdSource: sourceOf(stored.google?.clientId, env.COSMOS_GOOGLE_CLIENT_ID),
      secretConfigured: eff.googleClientSecret !== null,
      secretSource: sourceOf(stored.google?.clientSecret, env.COSMOS_GOOGLE_CLIENT_SECRET)
    }
  }
}

/**
 * Which logical clients' EFFECTIVE credentials changed between two effective configs
 * (FR-012/FR-013). Slack changes iff its effective clientId changed; Atlassian changes
 * iff its effective clientId OR client_secret changed (one client drives BOTH Jira and
 * Confluence). Identical effective values ⇒ no change ⇒ no force-disconnect (FR-013).
 */
export function diffEffective(
  before: EffectiveClientConfig,
  after: EffectiveClientConfig
): { slack: boolean; atlassian: boolean; google: boolean } {
  return {
    slack: before.slackClientId !== after.slackClientId,
    atlassian:
      before.atlassianClientId !== after.atlassianClientId ||
      before.atlassianClientSecret !== after.atlassianClientSecret,
    google:
      before.googleClientId !== after.googleClientId ||
      before.googleClientSecret !== after.googleClientSecret
  }
}
