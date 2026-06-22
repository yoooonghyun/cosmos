/**
 * Regression: the `settings:save` handler dropped Google's client id (and secret)
 * because the inline payload->config merge only handled slack + atlassian. The clear
 * handler had the same gap (google never copied through). Both hops now live in pure,
 * node-testable helpers covered here. See bug: "google calendar client id 저장 동작안함".
 */

import { describe, it, expect } from 'vitest'
import { mergeClientConfigSave, clearClientConfigField } from './clientConfigMutate'
import type { ClientConfig } from './integrations/clientConfigStore'
import type { ClientConfigSavePayload } from '../shared/ipc'

describe('mergeClientConfigSave', () => {
  it('persists a google clientId from the save payload (the reported bug)', () => {
    const payload: ClientConfigSavePayload = { google: { clientId: 'goog-123.apps' } }
    const next = mergeClientConfigSave({}, payload)
    expect(next.google?.clientId).toBe('goog-123.apps')
  })

  it('persists the google client secret too', () => {
    const payload: ClientConfigSavePayload = {
      google: { clientId: 'goog-123.apps', clientSecret: 'shh' }
    }
    const next = mergeClientConfigSave({}, payload)
    expect(next.google).toEqual({ clientId: 'goog-123.apps', clientSecret: 'shh' })
  })

  it('shallow-merges google onto stored google without clobbering the other field', () => {
    const current: ClientConfig = { google: { clientId: 'old-id', clientSecret: 'kept' } }
    const next = mergeClientConfigSave(current, { google: { clientId: 'new-id' } })
    expect(next.google).toEqual({ clientId: 'new-id', clientSecret: 'kept' })
  })

  it('still persists slack and atlassian (no regression)', () => {
    const payload: ClientConfigSavePayload = {
      slack: { clientId: 'sl' },
      atlassian: { clientId: 'at', clientSecret: 'as' }
    }
    const next = mergeClientConfigSave({}, payload)
    expect(next.slack).toEqual({ clientId: 'sl' })
    expect(next.atlassian).toEqual({ clientId: 'at', clientSecret: 'as' })
  })

  it('does not mutate the input config', () => {
    const current: ClientConfig = { google: { clientId: 'old' } }
    mergeClientConfigSave(current, { google: { clientId: 'new' } })
    expect(current.google?.clientId).toBe('old')
  })

  it('leaves google untouched when the payload omits it', () => {
    const current: ClientConfig = { google: { clientId: 'keep' } }
    const next = mergeClientConfigSave(current, { slack: { clientId: 'sl' } })
    expect(next.google?.clientId).toBe('keep')
  })
})

describe('clearClientConfigField', () => {
  it('clears google.clientId and prunes the empty sub-object', () => {
    const current: ClientConfig = { google: { clientId: 'gone' } }
    const next = clearClientConfigField(current, 'google.clientId')
    expect(next.google).toBeUndefined()
  })

  it('clears google.clientSecret but keeps the clientId', () => {
    const current: ClientConfig = { google: { clientId: 'keep', clientSecret: 'gone' } }
    const next = clearClientConfigField(current, 'google.clientSecret')
    expect(next.google).toEqual({ clientId: 'keep' })
  })

  it('does NOT strip stored google when clearing an unrelated slack field (the clear-hop gap)', () => {
    const current: ClientConfig = {
      slack: { clientId: 'sl' },
      google: { clientId: 'goog' }
    }
    const next = clearClientConfigField(current, 'slack.clientId')
    expect(next.slack).toBeUndefined()
    expect(next.google?.clientId).toBe('goog')
  })

  it('still clears slack/atlassian fields (no regression)', () => {
    const current: ClientConfig = { atlassian: { clientId: 'at', clientSecret: 'as' } }
    const next = clearClientConfigField(current, 'atlassian.clientId')
    expect(next.atlassian).toEqual({ clientSecret: 'as' })
  })
})
