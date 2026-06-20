/**
 * Settings — OAuth client configuration IPC surface.
 * Spec: .sdd/specs/settings-oauth-clients-v1.md. Re-exported (unchanged) through
 * the `src/shared/ipc.ts` barrel.
 *
 * Channel direction legend:
 *   M->R  main process emits to renderer (ipcRenderer.on)
 *   R->M  renderer sends to main process (ipcRenderer.send / invoke)
 */

/**
 * Settings IPC channel name constants (settings-oauth-clients-v1, FR-017). All
 * three are request/response via `ipcRenderer.invoke`/`ipcMain.handle`. NO channel
 * carries the Atlassian client_secret in either direction (FR-007, SC-006): the
 * renderer sends a NEW secret to set (write-only, R->M only on Save) and reads back
 * only a `secretConfigured` boolean — the secret value never returns to the renderer.
 */
export const SettingsChannelName = {
  /** R->M (invoke): current client-config status (ids + sources + secret-configured boolean; NEVER the secret). FR-014. */
  GetConfig: 'settings:getConfig',
  /** R->M (invoke): persist a subset of client config; force-disconnects affected integrations; resolves with a SaveResult. FR-006/FR-012. */
  Save: 'settings:save',
  /** R->M (invoke): clear ONE field back to the env fallback; same force-disconnect diffing; resolves with a SaveResult. FR-015. */
  ClearField: 'settings:clearField'
} as const

export type SettingsChannelNameValue =
  (typeof SettingsChannelName)[keyof typeof SettingsChannelName]

/**
 * Where an effective client-config value comes from (settings-oauth-clients-v1,
 * FR-009/FR-014):
 *  - `'settings'` — the user saved this value in Settings (it overrides env).
 *  - `'env'`      — no Settings value; the matching `COSMOS_*` env var supplies it.
 *  - `'unset'`    — neither Settings nor env provides a value (the integration
 *    simply cannot connect until one is set — a legal state per spec Edge Cases).
 */
export type ClientConfigSource = 'settings' | 'env' | 'unset'

/**
 * The renderer-safe client-config STATUS (settings-oauth-clients-v1, FR-014). The
 * ONLY config shape that crosses to the renderer. Client IDs are NOT secret and
 * round-trip for display/editing (FR-008); the Atlassian client_secret NEVER
 * appears here — the renderer learns only whether it is configured and from where
 * (FR-007, SC-006).
 */
export interface ClientConfigStatus {
  slack: {
    /** Effective Slack client id (Settings ?? env), or null when unset. FR-008/FR-009. */
    clientId: string | null
    /** Where the effective Slack client id comes from. FR-014. */
    source: ClientConfigSource
  }
  atlassian: {
    /** Effective Atlassian client id (Settings ?? env), or null when unset. FR-008/FR-009. */
    clientId: string | null
    /** Where the effective Atlassian client id comes from. FR-014. */
    clientIdSource: ClientConfigSource
    /** Whether an effective Atlassian client_secret exists — NEVER its value. FR-007/FR-014. */
    secretConfigured: boolean
    /** Where the effective Atlassian secret comes from (`'unset'` when not configured). FR-014. */
    secretSource: ClientConfigSource
  }
  google: {
    /** Effective Google client id (Settings ?? env), or null when unset. */
    clientId: string | null
    /** Where the effective Google client id comes from. */
    clientIdSource: ClientConfigSource
    /** Whether an effective Google client_secret exists — NEVER its value. */
    secretConfigured: boolean
    /** Where the effective Google secret comes from (`'unset'` when not configured). */
    secretSource: ClientConfigSource
  }
}

/**
 * R->M. Save a SUBSET of client config (settings-oauth-clients-v1, FR-015). Only
 * PRESENT keys are written; an ABSENT key leaves that stored field unchanged. An
 * explicit EMPTY STRING for an id means "revert to env" (unset that field), distinct
 * from absent. The write-only `clientSecret` is the ONLY field that carries a secret
 * across the boundary — R->M ONLY (it is never returned). An empty-string secret is
 * ignored (the secret is reverted only via ClearField — it has no value to "empty").
 */
export interface ClientConfigSavePayload {
  slack?: { clientId?: string }
  atlassian?: { clientId?: string; clientSecret?: string }
  google?: { clientId?: string; clientSecret?: string }
}

/** The clearable fields (settings-oauth-clients-v1, FR-015). */
export type ClientConfigField =
  | 'slack.clientId'
  | 'atlassian.clientId'
  | 'atlassian.clientSecret'
  | 'google.clientId'
  | 'google.clientSecret'

/**
 * R->M. Clear ONE specific field back to its env fallback (settings-oauth-clients-v1,
 * FR-015) — a distinct operation from saving a new value. The write-only secret is
 * reverted only through this path.
 */
export interface ClientConfigClearPayload {
  field: ClientConfigField
}

/**
 * M->R result of a Save / ClearField (settings-oauth-clients-v1, FR-006/FR-012).
 * Returns the post-operation `ClientConfigStatus` so the renderer reflects the new
 * source / secret-configured state without a second round-trip (and so the secret
 * value is never needed renderer-side). On an encryption-unavailable / write failure
 * NOTHING is persisted, `ok` is false, and `status` reflects the UNCHANGED config
 * (mirrors `TokenStore.save()` refusing plaintext). `disconnected` names which
 * integrations were force-disconnected by an effective credential change so the
 * renderer can message the user (e.g. "Slack was signed out").
 */
export interface ClientConfigSaveResult {
  /** True when the operation persisted (or was a valid no-op); false on a write/encryption failure. */
  ok: boolean
  /** Stable error kind for messaging; present only when `ok` is false. */
  errorKind?: 'encryption_unavailable' | 'write_failed' | 'invalid'
  /** Human-readable failure reason; present only when `ok` is false. NEVER contains a secret. */
  message?: string
  /** The post-operation renderer-safe status (NEVER the secret). */
  status: ClientConfigStatus
  /** Which integrations were force-disconnected by an effective credential change (FR-012). */
  disconnected: {
    slack: boolean
    jira: boolean
    confluence: boolean
    'google-calendar': boolean
  }
}

/**
 * The Settings API surface exposed to the renderer via `contextBridge` as
 * `window.cosmos.settings` (settings-oauth-clients-v1, FR-017), alongside (not merged
 * into) the other sub-APIs. NO method returns the Atlassian client_secret; `save`
 * carries a new secret to set R->M only (FR-007). NEW preload methods — a full
 * `npm run dev` restart is required (HMR alone leaves them `not a function`).
 */
export interface SettingsApi {
  /** R->M. Read the current client-config status (ids + sources + secret-configured; never the secret). FR-014. */
  getConfig(): Promise<ClientConfigStatus>
  /** R->M. Persist a subset of client config; force-disconnects affected integrations. FR-006/FR-012. */
  save(payload: ClientConfigSavePayload): Promise<ClientConfigSaveResult>
  /** R->M. Clear one field back to the env fallback. FR-015. */
  clearField(payload: ClientConfigClearPayload): Promise<ClientConfigSaveResult>
}
