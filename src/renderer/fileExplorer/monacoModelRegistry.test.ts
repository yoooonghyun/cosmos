import { describe, it, expect, vi } from 'vitest'
import {
  createMonacoModelRegistry,
  cosmosFileUri,
  type ModelFactory,
  type ModelLike
} from './monacoModelRegistry'

/*
 * cosmos-terminal-favorite-explorer-share-v1 — the ref-counted shared Monaco model registry
 * (Phase 2 node-unit). Monaco crashes jsdom, so the dispose/refcount logic is tested through an
 * INJECTED fake model factory (FR-003/FR-007, OQ-2/OQ-3). Covers: same uri → one model (no
 * duplicate create); acquire/detach move the refcount; dispose ONLY when (released AND refcount 0);
 * detach-while-open and release-while-attached do NOT dispose; re-acquire clears the released latch;
 * a different relPath (rename) is a different model; syncText only setValue when the value differs.
 */

/** A fake `ITextModel` recording its value + a dispose spy. */
function fakeModel(initial: string): ModelLike & { disposed: boolean; setValue: ReturnType<typeof vi.fn> } {
  let value = initial
  return {
    disposed: false,
    getValue: () => value,
    setValue: vi.fn((v: string) => {
      value = v
    }),
    dispose() {
      this.disposed = true
    }
  }
}

/** A factory that records every createModel call so duplicate-create is assertable. */
function fakeFactory(): {
  factory: ModelFactory
  created: Array<{ uri: string; text: string; language: string; model: ReturnType<typeof fakeModel> }>
} {
  const created: Array<{ uri: string; text: string; language: string; model: ReturnType<typeof fakeModel> }> = []
  const factory: ModelFactory = {
    getModel: () => null, // Monaco holds nothing; the registry's own map is the source of truth.
    createModel: (text, language, uri) => {
      const model = fakeModel(text)
      created.push({ uri, text, language, model })
      return model
    }
  }
  return { factory, created }
}

describe('cosmosFileUri — canonical key (OQ-2)', () => {
  it('keys by (paneId, relPath); a different relPath is a different key', () => {
    expect(cosmosFileUri('pane-1', 'src/a.ts')).toBe('cosmos-file://pane-1/src/a.ts')
    expect(cosmosFileUri('pane-1', 'src/a.ts')).not.toBe(cosmosFileUri('pane-1', 'src/b.ts'))
    expect(cosmosFileUri('pane-1', 'a.ts')).not.toBe(cosmosFileUri('pane-2', 'a.ts'))
  })
})

describe('acquire — one shared model per uri (FR-003)', () => {
  it('two acquires for the SAME file create ONE model (no duplicate create) and refcount 2', () => {
    const { factory, created } = fakeFactory()
    const reg = createMonacoModelRegistry(factory)
    const m1 = reg.acquire('pane-1', 'a.ts', 'hello', 'typescript')
    const m2 = reg.acquire('pane-1', 'a.ts', 'hello', 'typescript')
    expect(m1).toBe(m2) // same instance — both views render one buffer
    expect(created).toHaveLength(1) // created once, not per view
  })

  it('a DIFFERENT relPath yields a DIFFERENT model (rename = close+open, no migration — OQ-2)', () => {
    const { factory, created } = fakeFactory()
    const reg = createMonacoModelRegistry(factory)
    const a = reg.acquire('pane-1', 'a.ts', 'A', 'typescript')
    const b = reg.acquire('pane-1', 'b.ts', 'B', 'typescript')
    expect(a).not.toBe(b)
    expect(created).toHaveLength(2)
  })
})

describe('dispose ref-counting (FR-007/OQ-3 — the dispose-danger)', () => {
  it('disposes ONLY when released AND no view attached', () => {
    const { factory } = fakeFactory()
    const reg = createMonacoModelRegistry(factory)
    const model = reg.acquire('pane-1', 'a.ts', 'x', 'typescript') as ReturnType<typeof fakeModel>
    reg.release('pane-1', 'a.ts') // closed in the store, but one view still attached
    expect(model.disposed).toBe(false)
    reg.detach('pane-1', 'a.ts') // last view leaves → now disposable
    expect(model.disposed).toBe(true)
  })

  it('detach with the file STILL OPEN (not released) does NOT dispose (favorite tab-switch)', () => {
    const { factory } = fakeFactory()
    const reg = createMonacoModelRegistry(factory)
    const model = reg.acquire('pane-1', 'a.ts', 'x', 'typescript') as ReturnType<typeof fakeModel>
    reg.detach('pane-1', 'a.ts') // the only view detached, but the file is still open
    expect(model.disposed).toBe(false)
  })

  it('two views attached, one detaches → refcount 1, model survives (SC-004 dispose-danger)', () => {
    const { factory } = fakeFactory()
    const reg = createMonacoModelRegistry(factory)
    const model = reg.acquire('pane-1', 'a.ts', 'x', 'typescript') as ReturnType<typeof fakeModel>
    reg.acquire('pane-1', 'a.ts', 'x', 'typescript')
    reg.release('pane-1', 'a.ts') // file closed in store
    reg.detach('pane-1', 'a.ts') // one view leaves
    expect(model.disposed).toBe(false) // the OTHER view still renders it
    reg.detach('pane-1', 'a.ts') // last view leaves
    expect(model.disposed).toBe(true)
  })

  it('release while a view is still attached does NOT dispose; last detach after release disposes', () => {
    const { factory } = fakeFactory()
    const reg = createMonacoModelRegistry(factory)
    const model = reg.acquire('pane-1', 'a.ts', 'x', 'typescript') as ReturnType<typeof fakeModel>
    reg.acquire('pane-1', 'a.ts', 'x', 'typescript')
    reg.release('pane-1', 'a.ts')
    reg.detach('pane-1', 'a.ts')
    expect(model.disposed).toBe(false)
    reg.detach('pane-1', 'a.ts')
    expect(model.disposed).toBe(true)
  })

  it('re-acquire after release clears the released latch (re-open) — model is NOT later disposed on a stray detach', () => {
    const { factory } = fakeFactory()
    const reg = createMonacoModelRegistry(factory)
    const model = reg.acquire('pane-1', 'a.ts', 'x', 'typescript') as ReturnType<typeof fakeModel>
    reg.release('pane-1', 'a.ts') // closed in store, view still attached (not disposed)
    const reopened = reg.acquire('pane-1', 'a.ts', 'x', 'typescript') // re-open clears the latch
    expect(reopened).toBe(model)
    reg.detach('pane-1', 'a.ts') // one of the two views leaves — released latch was cleared
    expect(model.disposed).toBe(false)
    reg.detach('pane-1', 'a.ts') // last view leaves, but NOT released → still alive
    expect(model.disposed).toBe(false)
  })
})

describe('syncText — read-only content-sync (FR-003)', () => {
  it('calls setValue ONLY when the incoming text differs', () => {
    const { factory } = fakeFactory()
    const reg = createMonacoModelRegistry(factory)
    const model = reg.acquire('pane-1', 'a.ts', 'hello', 'typescript') as ReturnType<typeof fakeModel>
    reg.syncText(model, 'hello') // unchanged → no setValue
    expect(model.setValue).not.toHaveBeenCalled()
    reg.syncText(model, 'world') // changed → setValue
    expect(model.setValue).toHaveBeenCalledWith('world')
    expect(model.getValue()).toBe('world')
  })
})
