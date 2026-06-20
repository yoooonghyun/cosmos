import { describe, it, expect } from 'vitest'
import {
  resolveEffective,
  toStatus,
  diffEffective,
  type ClientConfigEnv
} from './clientConfigResolver'
import type { ClientConfig } from './integrations/clientConfigStore'

const emptyEnv: ClientConfigEnv = {}
const fullEnv: ClientConfigEnv = {
  COSMOS_SLACK_CLIENT_ID: 'env-slack',
  COSMOS_ATLASSIAN_CLIENT_ID: 'env-atl-id',
  COSMOS_ATLASSIAN_CLIENT_SECRET: 'env-atl-secret',
  COSMOS_GOOGLE_CLIENT_ID: 'env-google-id',
  COSMOS_GOOGLE_CLIENT_SECRET: 'env-google-secret'
}

describe('resolveEffective (Settings-over-env precedence)', () => {
  it('uses env when no Settings value is set', () => {
    expect(resolveEffective({}, fullEnv)).toEqual({
      slackClientId: 'env-slack',
      atlassianClientId: 'env-atl-id',
      atlassianClientSecret: 'env-atl-secret',
      googleClientId: 'env-google-id',
      googleClientSecret: 'env-google-secret'
    })
  })

  it('uses the Settings value over env, per field', () => {
    const stored: ClientConfig = {
      slack: { clientId: 'set-slack' },
      atlassian: { clientId: 'set-atl-id', clientSecret: 'set-atl-secret' },
      google: { clientId: 'set-google-id', clientSecret: 'set-google-secret' }
    }
    expect(resolveEffective(stored, fullEnv)).toEqual({
      slackClientId: 'set-slack',
      atlassianClientId: 'set-atl-id',
      atlassianClientSecret: 'set-atl-secret',
      googleClientId: 'set-google-id',
      googleClientSecret: 'set-google-secret'
    })
  })

  it('falls back to env when a Settings field is unset (clearing reverts to env)', () => {
    // Atlassian id saved, secret NOT saved → secret comes from env. Google id saved,
    // secret NOT saved → Google secret comes from env too.
    const stored: ClientConfig = {
      atlassian: { clientId: 'set-atl-id' },
      google: { clientId: 'set-google-id' }
    }
    expect(resolveEffective(stored, fullEnv)).toEqual({
      slackClientId: 'env-slack',
      atlassianClientId: 'set-atl-id',
      atlassianClientSecret: 'env-atl-secret',
      googleClientId: 'set-google-id',
      googleClientSecret: 'env-google-secret'
    })
  })

  it('resolves to null when neither Settings nor env provides a value', () => {
    expect(resolveEffective({}, emptyEnv)).toEqual({
      slackClientId: null,
      atlassianClientId: null,
      atlassianClientSecret: null,
      googleClientId: null,
      googleClientSecret: null
    })
  })
})

describe('toStatus (renderer-safe, secret never included)', () => {
  it('reports source "settings" for a saved id and never the secret value', () => {
    const stored: ClientConfig = {
      slack: { clientId: 'set-slack' },
      atlassian: { clientId: 'set-atl-id', clientSecret: 'TOP-SECRET' }
    }
    const status = toStatus(stored, fullEnv)
    expect(status.slack).toEqual({ clientId: 'set-slack', source: 'settings' })
    expect(status.atlassian.clientId).toBe('set-atl-id')
    expect(status.atlassian.clientIdSource).toBe('settings')
    expect(status.atlassian.secretConfigured).toBe(true)
    expect(status.atlassian.secretSource).toBe('settings')
    // The secret value must NOT appear anywhere in the serialized status.
    expect(JSON.stringify(status)).not.toContain('TOP-SECRET')
  })

  it('reports source "env" when the value comes from the environment', () => {
    const status = toStatus({}, fullEnv)
    expect(status.slack.source).toBe('env')
    expect(status.atlassian.clientIdSource).toBe('env')
    expect(status.atlassian.secretConfigured).toBe(true)
    expect(status.atlassian.secretSource).toBe('env')
  })

  it('reports source "unset" and secretConfigured false when nothing is configured', () => {
    const status = toStatus({}, emptyEnv)
    expect(status.slack).toEqual({ clientId: null, source: 'unset' })
    expect(status.atlassian).toEqual({
      clientId: null,
      clientIdSource: 'unset',
      secretConfigured: false,
      secretSource: 'unset'
    })
  })
})

describe('diffEffective (force-disconnect targeting)', () => {
  const base = {
    slackClientId: 'a',
    atlassianClientId: 'b',
    atlassianClientSecret: 'c',
    googleClientId: 'g',
    googleClientSecret: 'gs'
  }

  it('flags Slack when only the Slack effective id changed', () => {
    expect(diffEffective(base, { ...base, slackClientId: 'a2' })).toEqual({
      slack: true,
      atlassian: false,
      google: false
    })
  })

  it('flags Atlassian when its effective id changed', () => {
    expect(diffEffective(base, { ...base, atlassianClientId: 'b2' })).toEqual({
      slack: false,
      atlassian: true,
      google: false
    })
  })

  it('flags Atlassian when only its effective secret changed', () => {
    expect(diffEffective(base, { ...base, atlassianClientSecret: 'c2' })).toEqual({
      slack: false,
      atlassian: true,
      google: false
    })
  })

  it('flags Google when only its effective id changed', () => {
    expect(diffEffective(base, { ...base, googleClientId: 'g2' })).toEqual({
      slack: false,
      atlassian: false,
      google: true
    })
  })

  it('flags Google when only its effective secret changed', () => {
    expect(diffEffective(base, { ...base, googleClientSecret: 'gs2' })).toEqual({
      slack: false,
      atlassian: false,
      google: true
    })
  })

  it('reports no change for identical effective values (re-save is a no-op)', () => {
    expect(diffEffective(base, { ...base })).toEqual({
      slack: false,
      atlassian: false,
      google: false
    })
  })

  it('treats a clear-to-env that does NOT alter the effective value as no change', () => {
    const env: ClientConfigEnv = { COSMOS_ATLASSIAN_CLIENT_ID: 'same' }
    const before = resolveEffective({ atlassian: { clientId: 'same' } }, env)
    const after = resolveEffective({}, env) // cleared Settings, env has the same value
    expect(diffEffective(before, after).atlassian).toBe(false)
  })

  it('treats a clear-to-env that DOES alter the effective value as a change', () => {
    const env: ClientConfigEnv = { COSMOS_ATLASSIAN_CLIENT_ID: 'env-different' }
    const before = resolveEffective({ atlassian: { clientId: 'settings-value' } }, env)
    const after = resolveEffective({}, env) // cleared → falls back to a DIFFERENT env value
    expect(diffEffective(before, after).atlassian).toBe(true)
  })
})
