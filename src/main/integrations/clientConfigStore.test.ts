import { describe, it, expect } from 'vitest'
import {
  ClientConfigStore,
  ClientConfigEncryptionUnavailableError,
  type ClientConfig,
  type ClientConfigStoreDeps
} from './clientConfigStore'
import type { FsLike, SafeStorageLike } from './tokenStore'

const FILE = '/userData/integrations/clientConfig.enc'
const DIR = '/userData/integrations'

/** In-memory fs recording writes; mirrors the tokenStore/sessionStore test shape. */
function makeFs(): FsLike & { files: Map<string, Buffer>; writes: string[] } {
  const files = new Map<string, Buffer>()
  const writes: string[] = []
  return {
    files,
    writes,
    existsSync: (p) => files.has(p),
    readFileSync: (p) => {
      const b = files.get(p)
      if (!b) throw new Error('ENOENT')
      return b
    },
    writeFileSync: (p, data) => {
      writes.push(p)
      files.set(p, data)
    },
    mkdirSync: () => {},
    rmSync: (p) => {
      files.delete(p)
    }
  }
}

/**
 * A reversible XOR "cipher" so the on-disk bytes DIFFER from plaintext (assertable as
 * ciphertext) yet round-trip. `available` toggles `isEncryptionAvailable`.
 */
function makeSafeStorage(available = true): SafeStorageLike {
  const key = 0x5a
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => {
      const buf = Buffer.from(plain, 'utf8')
      return Buffer.from(buf.map((b) => b ^ key))
    },
    decryptString: (cipher) => Buffer.from(cipher.map((b) => b ^ key)).toString('utf8')
  }
}

function makeStore(deps?: Partial<ClientConfigStoreDeps>) {
  const fs = deps?.fs ?? makeFs()
  const safeStorage = deps?.safeStorage ?? makeSafeStorage()
  const store = new ClientConfigStore({
    filePath: FILE,
    dirPath: DIR,
    fs,
    safeStorage,
    ...deps
  })
  return { store, fs: fs as ReturnType<typeof makeFs>, safeStorage }
}

const SECRET = 'super-secret-atlassian-value-123'

const fullConfig: ClientConfig = {
  slack: { clientId: 'slack-id-1' },
  atlassian: { clientId: 'atl-id-1', clientSecret: SECRET }
}

describe('ClientConfigStore', () => {
  it('round-trips a saved config through save/load', () => {
    const { store } = makeStore()
    store.save(fullConfig)
    expect(store.load()).toEqual(fullConfig)
  })

  it('persists ciphertext on disk — never the plaintext secret', () => {
    const { store, fs } = makeStore()
    store.save(fullConfig)
    const onDisk = fs.files.get(FILE)!.toString('utf8')
    // The encrypted bytes must NOT contain the secret, the slack id, or the JSON key.
    expect(onDisk).not.toContain(SECRET)
    expect(onDisk).not.toContain('slack-id-1')
    expect(onDisk).not.toContain('clientSecret')
  })

  it('decrypts a fresh store from disk (cross-instance round-trip)', () => {
    const fs = makeFs()
    const safeStorage = makeSafeStorage()
    new ClientConfigStore({ filePath: FILE, dirPath: DIR, fs, safeStorage }).save(fullConfig)
    // A NEW store instance reading the same disk decrypts the same config.
    const fresh = new ClientConfigStore({ filePath: FILE, dirPath: DIR, fs, safeStorage })
    expect(fresh.load()).toEqual(fullConfig)
  })

  it('throws and writes nothing when encryption is unavailable (refuses plaintext)', () => {
    const { store, fs } = makeStore({ safeStorage: makeSafeStorage(false) })
    expect(() => store.save(fullConfig)).toThrow(ClientConfigEncryptionUnavailableError)
    expect(fs.writes).toHaveLength(0)
    expect(fs.files.has(FILE)).toBe(false)
  })

  it('returns an empty config when no blob exists', () => {
    const { store } = makeStore()
    expect(store.load()).toEqual({})
  })

  it('treats a corrupt/undecryptable blob as empty (falls back to env, no throw)', () => {
    const fs = makeFs()
    fs.files.set(FILE, Buffer.from('not-valid-cipher'))
    const safeStorage: SafeStorageLike = {
      isEncryptionAvailable: () => true,
      encryptString: (p) => Buffer.from(p),
      decryptString: () => {
        throw new Error('bad blob')
      }
    }
    const store = new ClientConfigStore({ filePath: FILE, dirPath: DIR, fs, safeStorage })
    expect(store.load()).toEqual({})
  })

  it('clear() removes the blob and resets to empty', () => {
    const { store, fs } = makeStore()
    store.save(fullConfig)
    store.clear()
    expect(fs.files.has(FILE)).toBe(false)
    expect(store.load()).toEqual({})
  })

  it('sanitizes empty-string fields to "unset" (absent) on save', () => {
    const { store } = makeStore()
    store.save({ slack: { clientId: '' }, atlassian: { clientId: 'x', clientSecret: '' } })
    expect(store.load()).toEqual({ atlassian: { clientId: 'x' } })
  })
})
