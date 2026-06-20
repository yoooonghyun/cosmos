/**
 * `safeStorage`-encrypted, main-only store for the OAuth CLIENT credentials the
 * user configures via Settings (settings-oauth-clients-v1, FR-006/FR-007).
 *
 * Persists the saved client config — Slack client id, Atlassian client id +
 * client_secret — as ONE encrypted blob on disk via Electron `safeStorage`
 * (OS-keychain-backed), a sibling of the `*.token.enc` blobs. This is the SAME
 * pattern as `TokenStore`: plaintext is NEVER written to disk, and `save()` THROWS
 * rather than write plaintext when encryption is unavailable (FR-006, edge case).
 *
 * Only the fields the user has SET are present in the stored config — absence ⇒
 * fall back to the matching env var (the resolver does the merge). The Atlassian
 * client_secret lives ONLY here and is never returned to the renderer; the store
 * exposes the decrypted config only to in-process callers (the resolver + the save
 * handler), exactly like `TokenStore` exposes a token only in-process.
 *
 * `safeStorage`/`fs` are injected behind the same small interfaces `TokenStore`
 * uses so the store is unit-testable without Electron and the on-disk bytes can be
 * asserted to be ciphertext (never the plaintext secret) — SC-006.
 */

import type { FsLike, SafeStorageLike } from './tokenStore'

/**
 * The persisted client config (settings-oauth-clients-v1). Only set fields are
 * present; an absent field falls back to env at resolve time. The Atlassian
 * `clientSecret` is the ONLY secret-bearing field and never crosses to the renderer.
 */
export interface ClientConfig {
  slack?: { clientId?: string }
  atlassian?: { clientId?: string; clientSecret?: string }
  google?: { clientId?: string; clientSecret?: string }
}

export interface ClientConfigStoreDeps {
  /** Absolute path of the encrypted blob (e.g. `<userData>/integrations/clientConfig.enc`). */
  filePath: string
  /** Directory of `filePath`, created on save. */
  dirPath: string
  safeStorage: SafeStorageLike
  fs: FsLike
}

/** Thrown by `save()` when `safeStorage` encryption is unavailable (FR-006, edge case). */
export class ClientConfigEncryptionUnavailableError extends Error {
  constructor() {
    super('safeStorage encryption unavailable — refusing to persist client config in plaintext')
    this.name = 'ClientConfigEncryptionUnavailableError'
  }
}

export class ClientConfigStore {
  private readonly deps: ClientConfigStoreDeps
  private cache: ClientConfig | null = null
  private loaded = false

  constructor(deps: ClientConfigStoreDeps) {
    this.deps = deps
  }

  /**
   * Load + decrypt the saved client config, or an EMPTY config when none exists or
   * the blob is corrupt/unreadable (treated as "nothing saved", so the resolver
   * falls back to env). Cached in-process; never returned to the renderer.
   */
  load(): ClientConfig {
    if (this.loaded) {
      return this.cache ?? {}
    }
    this.loaded = true
    const { fs, safeStorage, filePath } = this.deps
    if (!fs.existsSync(filePath)) {
      this.cache = {}
      return this.cache
    }
    try {
      const cipher = fs.readFileSync(filePath)
      const plain = safeStorage.decryptString(cipher)
      const parsed = JSON.parse(plain) as unknown
      this.cache = sanitize(parsed)
    } catch {
      // Corrupt/unreadable blob (e.g. keychain changed) — treat as nothing saved so
      // the resolver falls back to env rather than crashing.
      this.cache = {}
    }
    return this.cache
  }

  /**
   * Encrypt + persist the FULL client config (the caller computes the merged config
   * to write). Plaintext JSON is encrypted via `safeStorage` BEFORE writing; the only
   * `writeFileSync` call receives ciphertext (FR-006, SC-006). THROWS
   * {@link ClientConfigEncryptionUnavailableError} if encryption is unavailable rather
   * than writing plaintext — nothing is persisted and the existing blob is untouched.
   */
  save(config: ClientConfig): void {
    const { fs, safeStorage, filePath, dirPath } = this.deps
    if (!safeStorage.isEncryptionAvailable()) {
      throw new ClientConfigEncryptionUnavailableError()
    }
    const sanitized = sanitize(config)
    const cipher = safeStorage.encryptString(JSON.stringify(sanitized))
    fs.mkdirSync(dirPath, { recursive: true })
    fs.writeFileSync(filePath, cipher)
    this.cache = sanitized
    this.loaded = true
  }

  /** Delete the stored blob and clear the cache (revert ALL Settings to env). */
  clear(): void {
    const { fs, filePath } = this.deps
    try {
      fs.rmSync(filePath, { force: true })
    } catch {
      // best effort
    }
    this.cache = {}
    this.loaded = true
  }
}

/**
 * Defensively coerce parsed JSON to a `ClientConfig` (settings-oauth-clients-v1,
 * SC-007 spirit). Only the known fields with string values survive; empty-string
 * fields are dropped (an empty id means "unset"); any other shape is ignored. This
 * keeps a corrupt/tampered blob from injecting unexpected structure.
 */
function sanitize(raw: unknown): ClientConfig {
  if (typeof raw !== 'object' || raw === null) {
    return {}
  }
  const obj = raw as Record<string, unknown>
  const out: ClientConfig = {}

  const slackId = pickString((obj.slack as Record<string, unknown> | undefined)?.clientId)
  if (slackId !== undefined) {
    out.slack = { clientId: slackId }
  }

  const atl = obj.atlassian as Record<string, unknown> | undefined
  const atlId = pickString(atl?.clientId)
  const atlSecret = pickString(atl?.clientSecret)
  if (atlId !== undefined || atlSecret !== undefined) {
    out.atlassian = {
      ...(atlId !== undefined ? { clientId: atlId } : {}),
      ...(atlSecret !== undefined ? { clientSecret: atlSecret } : {})
    }
  }

  const goog = obj.google as Record<string, unknown> | undefined
  const googId = pickString(goog?.clientId)
  const googSecret = pickString(goog?.clientSecret)
  if (googId !== undefined || googSecret !== undefined) {
    out.google = {
      ...(googId !== undefined ? { clientId: googId } : {}),
      ...(googSecret !== undefined ? { clientSecret: googSecret } : {})
    }
  }

  return out
}

/** A non-empty string, else undefined (empty ⇒ unset; non-string ⇒ ignored). */
function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
