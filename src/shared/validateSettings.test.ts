import { describe, it, expect, vi } from 'vitest'
import { validateClientConfigSave, validateClientConfigClear } from './validate'

describe('validateClientConfigSave', () => {
  it('accepts an empty object (valid no-op save)', () => {
    expect(validateClientConfigSave({})).toEqual({})
  })

  it('accepts a partial save with only the Slack id', () => {
    expect(validateClientConfigSave({ slack: { clientId: 'x' } })).toEqual({
      slack: { clientId: 'x' }
    })
  })

  it('accepts an Atlassian id + secret', () => {
    expect(
      validateClientConfigSave({ atlassian: { clientId: 'a', clientSecret: 's' } })
    ).toEqual({ atlassian: { clientId: 'a', clientSecret: 's' } })
  })

  it('accepts an explicit empty string id (the "revert to env" sentinel)', () => {
    expect(validateClientConfigSave({ slack: { clientId: '' } })).toEqual({
      slack: { clientId: '' }
    })
  })

  it('rejects a non-object payload (warned, null)', () => {
    const warn = vi.fn()
    expect(validateClientConfigSave(null, warn)).toBeNull()
    expect(validateClientConfigSave('nope', warn)).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('rejects a non-object slack/atlassian section', () => {
    const warn = vi.fn()
    expect(validateClientConfigSave({ slack: 'bad' }, warn)).toBeNull()
    expect(validateClientConfigSave({ atlassian: 5 }, warn)).toBeNull()
  })

  it('rejects a non-string clientId / clientSecret', () => {
    const warn = vi.fn()
    expect(validateClientConfigSave({ slack: { clientId: 123 } }, warn)).toBeNull()
    expect(validateClientConfigSave({ atlassian: { clientSecret: {} } }, warn)).toBeNull()
  })

  it('NEVER logs the raw payload (so a secret can never leak through a warn)', () => {
    const warn = vi.fn()
    validateClientConfigSave({ atlassian: { clientSecret: 12345 } }, warn)
    // The secret-bearing save validator passes only key/type descriptions to warn,
    // never the payload object itself.
    for (const call of warn.mock.calls) {
      for (const arg of call) {
        expect(arg).not.toBe(12345)
        if (typeof arg === 'object' && arg !== null) {
          expect(JSON.stringify(arg)).not.toContain('12345')
        }
      }
    }
  })

  it('drops unknown extra keys (only known fields survive)', () => {
    expect(
      validateClientConfigSave({ slack: { clientId: 'x', bogus: 1 }, extra: true })
    ).toEqual({ slack: { clientId: 'x' } })
  })
})

describe('validateClientConfigClear', () => {
  it('accepts each known clearable field', () => {
    for (const field of ['slack.clientId', 'atlassian.clientId', 'atlassian.clientSecret'] as const) {
      expect(validateClientConfigClear({ field })).toEqual({ field })
    }
  })

  it('rejects an unknown field value (warned, null)', () => {
    const warn = vi.fn()
    expect(validateClientConfigClear({ field: 'slack.secret' }, warn)).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('rejects a non-object payload and a missing/non-string field', () => {
    const warn = vi.fn()
    expect(validateClientConfigClear(null, warn)).toBeNull()
    expect(validateClientConfigClear({}, warn)).toBeNull()
    expect(validateClientConfigClear({ field: 42 }, warn)).toBeNull()
  })
})
