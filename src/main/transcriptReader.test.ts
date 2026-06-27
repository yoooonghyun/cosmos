import { describe, it, expect } from 'vitest'
import { TranscriptReader, encodeProjectDirKey, type TranscriptFsLike } from './transcriptReader'

describe('encodeProjectDirKey (OQ-V2-pathkey)', () => {
  it('replaces / and . with - (claude cwd encoding)', () => {
    expect(encodeProjectDirKey('/Users/me/Library/Application Support/cosmos/sandbox')).toBe(
      '-Users-me-Library-Application Support-cosmos-sandbox'
    )
    expect(encodeProjectDirKey('/a.b/c')).toBe('-a-b-c')
  })
})

function makeReader(opts: {
  files: Record<string, string>
  dirs?: Record<string, string[]>
  sessionId?: string | null
  sandboxDir?: string
}): TranscriptReader {
  const fs: TranscriptFsLike = {
    existsSync: (p) => p in opts.files || (opts.dirs ? p in opts.dirs : false),
    readFileSync: (p) => {
      if (!(p in opts.files)) {
        throw new Error('ENOENT')
      }
      return opts.files[p]
    },
    readdirSync: (p) => opts.dirs?.[p] ?? []
  }
  return new TranscriptReader({
    homeDir: '/home/me',
    sandboxDir: opts.sandboxDir ?? '/data/sandbox',
    loadDefaultSessionId: () => opts.sessionId ?? 'sess-1',
    fs
  })
}

describe('TranscriptReader.read (FR-105/FR-108)', () => {
  const derivedPath = '/home/me/.claude/projects/-data-sandbox/sess-1.jsonl'

  it('returns empty when no persisted session id exists', () => {
    const reader = makeReader({ files: {}, sessionId: null })
    expect(reader.read()).toEqual({ ok: false, reason: 'empty' })
  })

  it('returns empty when the transcript file is missing', () => {
    const reader = makeReader({ files: {} })
    expect(reader.read()).toEqual({ ok: false, reason: 'empty' })
  })

  it('reads + parses the derived path into a populated conversation', () => {
    const reader = makeReader({
      files: {
        [derivedPath]: JSON.stringify({
          type: 'user',
          uuid: 'u1',
          timestamp: 't',
          message: { content: 'hello' }
        })
      }
    })
    const result = reader.read()
    expect(result).toEqual({
      ok: true,
      conversation: {
        sessionId: 'sess-1',
        state: 'populated',
        turns: [{ kind: 'user-prompt', id: 'u1', ts: 't', text: 'hello' }]
      }
    })
  })

  it('returns ok:true empty when the file exists but has no conversational turns', () => {
    const reader = makeReader({
      files: { [derivedPath]: JSON.stringify({ type: 'permission-mode', uuid: 'n', timestamp: 't' }) }
    })
    expect(reader.read()).toEqual({
      ok: true,
      conversation: { sessionId: 'sess-1', state: 'empty', turns: [] }
    })
  })

  it('falls back to scanning projects/* when the derived dir-key differs', () => {
    const scannedPath = '/home/me/.claude/projects/weird-key/sess-1.jsonl'
    const reader = makeReader({
      files: {
        [scannedPath]: JSON.stringify({
          type: 'user',
          uuid: 'u2',
          timestamp: 't',
          message: { content: 'via scan' }
        })
      },
      dirs: { '/home/me/.claude/projects': ['weird-key'] }
    })
    const result = reader.read()
    expect(result.ok).toBe(true)
    expect(result.ok && result.conversation.turns[0]).toMatchObject({ text: 'via scan' })
  })

  it('confines reads to the derived/scanned path under ~/.claude/projects', () => {
    const reader = makeReader({ files: { [derivedPath]: '{}' } })
    expect(reader.resolveTranscriptPath()).toBe(derivedPath)
  })
})
