import { describe, it, expect } from 'vitest'
import { adfToPlainText, plainTextToStorage, storageToPlainText } from './atlassianText'

describe('adfToPlainText (design Q1)', () => {
  it('concatenates text leaves with block boundaries as newlines', () => {
    const adf = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First line.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second line.' }] }
      ]
    }
    expect(adfToPlainText(adf)).toBe('First line.\nSecond line.')
  })

  it('turns a hardBreak into a newline', () => {
    const adf = {
      type: 'paragraph',
      content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }]
    }
    expect(adfToPlainText(adf)).toBe('a\nb')
  })

  it('returns "" for absent/empty/non-ADF input (missing optional must not error)', () => {
    expect(adfToPlainText(undefined)).toBe('')
    expect(adfToPlainText(null)).toBe('')
    expect(adfToPlainText({})).toBe('')
    expect(adfToPlainText(42)).toBe('')
  })

  it('accepts an already-plain string', () => {
    expect(adfToPlainText('  plain  ')).toBe('plain')
  })
})

describe('storageToPlainText (design Q2)', () => {
  it('strips tags, decodes entities, and collapses blank lines', () => {
    const storage = '<h1>Title</h1><p>Hello &amp; welcome.</p><p>Bye.</p>'
    expect(storageToPlainText(storage)).toBe('Title\nHello & welcome.\nBye.')
  })

  it('treats <br> as a newline', () => {
    expect(storageToPlainText('a<br/>b')).toBe('a\nb')
  })

  it('returns "" for empty/non-string input', () => {
    expect(storageToPlainText('')).toBe('')
    expect(storageToPlainText(undefined)).toBe('')
    expect(storageToPlainText(123)).toBe('')
  })
})

describe('plainTextToStorage', () => {
  it('wraps a single line in one paragraph (happy path)', () => {
    expect(plainTextToStorage('Hello world')).toBe('<p>Hello world</p>')
  })

  it('wraps each line in its own paragraph (preserves breaks)', () => {
    expect(plainTextToStorage('line one\nline two')).toBe('<p>line one</p><p>line two</p>')
  })

  it('HTML-escapes the five special characters (no markup injection)', () => {
    expect(plainTextToStorage('a & b < c > d "e" \'f\'')).toBe(
      '<p>a &amp; b &lt; c &gt; d &quot;e&quot; &#39;f&#39;</p>'
    )
  })

  it('yields a single empty paragraph for an empty body (still valid storage)', () => {
    expect(plainTextToStorage('')).toBe('<p></p>')
  })

  it('round-trips back to the original text via storageToPlainText', () => {
    expect(storageToPlainText(plainTextToStorage('a & b\nsecond <line>'))).toBe('a & b\nsecond <line>')
  })
})
