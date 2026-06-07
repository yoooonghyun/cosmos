import { describe, it, expect } from 'vitest'
import {
  expiryFromSeconds,
  TokenStore,
  type FsLike,
  type SafeStorageLike,
  type StoredTokenSet
} from './tokenStore'

/** An in-memory fs that records exactly what bytes were written. */
function makeFs(): FsLike & { files: Map<string, Buffer>; dirs: Set<string> } {
  const files = new Map<string, Buffer>()
  const dirs = new Set<string>()
  return {
    files,
    dirs,
    existsSync: (p) => files.has(p),
    readFileSync: (p) => {
      const b = files.get(p)
      if (!b) throw new Error('ENOENT')
      return b
    },
    writeFileSync: (p, data) => {
      files.set(p, data)
    },
    mkdirSync: (p) => {
      dirs.add(p)
    },
    rmSync: (p) => {
      files.delete(p)
    }
  }
}

/**
 * A fake safeStorage that "encrypts" by XOR-ing with a marker so the on-disk
 * bytes are demonstrably NOT the plaintext token (SC-008), and decrypts back.
 */
function makeSafeStorage(available = true): SafeStorageLike {
  const MARK = 0x5a
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => {
      const buf = Buffer.from(plain, 'utf8')
      return Buffer.from(buf.map((b) => b ^ MARK))
    },
    decryptString: (cipher) => Buffer.from(cipher.map((b) => b ^ MARK)).toString('utf8')
  }
}

const sample: StoredTokenSet = {
  accessToken: 'xoxb-SECRET-12345',
  refreshToken: 'xoxe-REFRESH-67890',
  scopes: ['channels:read', 'search:read'],
  accountId: 'T1',
  accountName: 'Acme',
  extra: { userToken: 'xoxp-USER-secret' }
}

function makeStore(overrides?: { now?: () => number; available?: boolean }) {
  const fs = makeFs()
  const safeStorage = makeSafeStorage(overrides?.available ?? true)
  const store = new TokenStore({
    filePath: '/u/integrations/slack.token.enc',
    dirPath: '/u/integrations',
    fs,
    safeStorage,
    ...(overrides?.now ? { now: overrides.now } : {})
  })
  return { store, fs, safeStorage }
}

describe('TokenStore (FR-005, FR-006, SC-001, SC-008, SC-010)', () => {
  it('round-trips a token set through save -> load', () => {
    const { store } = makeStore()
    store.save(sample)
    // fresh store reading the same fs sees the decrypted set
    expect(store.load()).toEqual(sample)
    expect(store.has()).toBe(true)
  })

  it('writes only ciphertext to disk — the plaintext token never appears (SC-008)', () => {
    const { store, fs } = makeStore()
    store.save(sample)
    const onDisk = fs.files.get('/u/integrations/slack.token.enc')!
    const asText = onDisk.toString('utf8')
    expect(asText).not.toContain('xoxb-SECRET-12345')
    expect(asText).not.toContain('xoxp-USER-secret')
    expect(asText).not.toContain('accessToken')
  })

  it('clear() removes the blob and reports not stored (FR-009, SC-010)', () => {
    const { store, fs } = makeStore()
    store.save(sample)
    store.clear()
    expect(fs.files.has('/u/integrations/slack.token.enc')).toBe(false)
    expect(store.has()).toBe(false)
    expect(store.load()).toBeNull()
  })

  it('refuses to persist when encryption is unavailable (never plaintext)', () => {
    const { store, fs } = makeStore({ available: false })
    expect(() => store.save(sample)).toThrow(/unavailable/)
    expect(fs.files.size).toBe(0)
  })

  it('isExpired is false when no expiry is recorded', () => {
    const { store } = makeStore()
    store.save(sample)
    expect(store.isExpired()).toBe(false)
  })

  it('isExpired is true once the clock passes expiry minus skew', () => {
    let t = 1_000_000
    const { store } = makeStore({ now: () => t })
    store.save({ ...sample, expiresAtMs: t + 100_000 })
    expect(store.isExpired(0)).toBe(false)
    t += 100_001
    expect(store.isExpired(0)).toBe(true)
  })

  it('load returns null on a corrupt/unreadable blob (treat as not-connected)', () => {
    const fs = makeFs()
    fs.files.set('/u/integrations/slack.token.enc', Buffer.from('not-valid-cipher'))
    const store = new TokenStore({
      filePath: '/u/integrations/slack.token.enc',
      dirPath: '/u/integrations',
      fs,
      // decrypt yields garbage that JSON.parse rejects
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s) => Buffer.from(s),
        decryptString: () => '{not json'
      }
    })
    expect(store.load()).toBeNull()
  })
})

describe('expiryFromSeconds', () => {
  it('converts seconds to an absolute epoch-ms', () => {
    expect(expiryFromSeconds(3600, () => 1000)).toBe(1000 + 3_600_000)
  })
  it('returns undefined when no expiry given', () => {
    expect(expiryFromSeconds(undefined)).toBeUndefined()
  })
})
