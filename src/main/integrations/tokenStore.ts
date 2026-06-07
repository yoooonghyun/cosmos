/**
 * Refresh-aware, `safeStorage`-encrypted token store (integration foundation,
 * generic). Slack integration v1 — kept integration-agnostic so Jira/Confluence
 * reuse it (FR-010, SC-012).
 *
 * Persists the full token set (access token, refresh token, expiry, scopes,
 * account identity) as ONE encrypted blob on disk via Electron `safeStorage`
 * (OS-keychain-backed). Plaintext is NEVER written to disk, and the token set is
 * NEVER returned to the renderer or the embedded sandbox in plaintext (FR-005,
 * FR-006, SC-008). The store only exposes the decrypted set to in-process callers
 * (SlackManager); the manager attaches the token to outbound Slack calls.
 *
 * Electron's `safeStorage` and `fs` are injected behind small interfaces so the
 * store is unit-testable without Electron, and the on-disk bytes can be asserted
 * to be ciphertext (never the plaintext token) — SC-008.
 */

/**
 * The persisted token set. Provider-agnostic: `extra` carries provider-specific
 * fields (e.g. Slack's user token + team identity) without leaking provider
 * specifics into the foundation type.
 */
export interface StoredTokenSet {
  /** The primary access token. */
  accessToken: string
  /** Refresh token, when the provider issues one. */
  refreshToken?: string
  /** Absolute expiry as epoch milliseconds, when known. */
  expiresAtMs?: number
  /** Granted scopes (for capability checks like search availability). */
  scopes?: string[]
  /** Stable account/workspace identity (non-secret), for display. */
  accountId?: string
  accountName?: string
  /** Provider-specific extras (e.g. userToken, teamId). Non-foundation fields. */
  extra?: Record<string, unknown>
}

/** The slice of Electron `safeStorage` the store needs (injectable for tests). */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(cipher: Buffer): string
}

/** The slice of `fs` the store needs (injectable for tests). */
export interface FsLike {
  existsSync(path: string): boolean
  readFileSync(path: string): Buffer
  writeFileSync(path: string, data: Buffer): void
  mkdirSync(path: string, opts: { recursive: true }): void
  rmSync(path: string, opts: { force: true }): void
}

export interface TokenStoreDeps {
  /** Absolute path of the encrypted blob (e.g. `<userData>/integrations/slack.token.enc`). */
  filePath: string
  /** Directory of `filePath`, created on save. */
  dirPath: string
  safeStorage: SafeStorageLike
  fs: FsLike
  /** Injectable clock (ms) for expiry checks; defaults to `Date.now`. */
  now?: () => number
}

export class TokenStore {
  private readonly deps: TokenStoreDeps
  private cache: StoredTokenSet | null = null
  /** Tracks whether we've attempted a disk load yet (lazy). */
  private loaded = false

  constructor(deps: TokenStoreDeps) {
    this.deps = deps
  }

  private get now(): () => number {
    return this.deps.now ?? Date.now
  }

  /**
   * Load and decrypt the token set from disk, or null if none / unreadable.
   * Cached in-process; never returned to the renderer (SC-008).
   */
  load(): StoredTokenSet | null {
    if (this.loaded) {
      return this.cache
    }
    this.loaded = true
    const { fs, safeStorage, filePath } = this.deps
    if (!fs.existsSync(filePath)) {
      this.cache = null
      return null
    }
    try {
      const cipher = fs.readFileSync(filePath)
      const plain = safeStorage.decryptString(cipher)
      this.cache = JSON.parse(plain) as StoredTokenSet
    } catch {
      // Corrupt/unreadable blob (e.g. keychain changed) — treat as not-connected.
      this.cache = null
    }
    return this.cache
  }

  /**
   * Encrypt and persist the token set. The plaintext JSON is encrypted via
   * `safeStorage` BEFORE writing; the only `writeFileSync` call receives
   * ciphertext (FR-005, SC-008). Throws if encryption is unavailable rather than
   * writing plaintext.
   */
  save(tokens: StoredTokenSet): void {
    const { fs, safeStorage, filePath, dirPath } = this.deps
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage encryption unavailable — refusing to persist token in plaintext')
    }
    const cipher = safeStorage.encryptString(JSON.stringify(tokens))
    fs.mkdirSync(dirPath, { recursive: true })
    fs.writeFileSync(filePath, cipher)
    this.cache = tokens
    this.loaded = true
  }

  /** Delete the stored blob and clear the cache (Disconnect — FR-009, SC-010). */
  clear(): void {
    const { fs, filePath } = this.deps
    try {
      fs.rmSync(filePath, { force: true })
    } catch {
      // best effort
    }
    this.cache = null
    this.loaded = true
  }

  /** Whether a token set is currently stored. */
  has(): boolean {
    return this.load() !== null
  }

  /**
   * Whether the stored access token is past (or within `skewMs` of) its expiry.
   * No expiry recorded -> not considered expired (provider may not rotate).
   */
  isExpired(skewMs = 60_000): boolean {
    const tokens = this.load()
    if (!tokens || typeof tokens.expiresAtMs !== 'number') {
      return false
    }
    return this.now() >= tokens.expiresAtMs - skewMs
  }
}

/** Helper: convert a provider `expires_in` (seconds) to an absolute epoch-ms. */
export function expiryFromSeconds(
  expiresInSeconds: number | undefined,
  now: () => number = Date.now
): number | undefined {
  if (typeof expiresInSeconds !== 'number') {
    return undefined
  }
  return now() + expiresInSeconds * 1000
}
