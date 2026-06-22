/**
 * Channel-string uniqueness guard for the modular IPC contract (FR-011, SC-006).
 *
 * The IPC contract is physically split into per-domain modules under
 * `src/shared/ipc/`, each declaring its own `*Channel` / `*ChannelName` const. This
 * test aggregates EVERY wire string from EVERY domain module (imported through the
 * single authoritative barrel) and asserts the union has no duplicates — so the split
 * can never silently introduce two domains sharing one wire string.
 *
 * Negative control: if, say, `pty.ts` reused `'ui:render'`, or two modules both
 * declared `'jira:getStatus'`, the flattened array would contain that string twice and
 * `new Set(all).size` would be LESS than `all.length`, failing the assertion below.
 */

import { describe, expect, it } from 'vitest'
import {
  AgentChannel,
  ConfluenceChannelName,
  GoogleCalendarChannelName,
  JiraChannelName,
  PtyChannel,
  SessionChannel,
  SettingsChannelName,
  ShortcutChannel,
  SlackChannelName,
  UiChannel
} from './../ipc'
import { SESSION_SCHEMA_VERSION } from './../ipc'

/** Every per-domain channel const, flattened to its wire-string values. */
const allWireStrings: string[] = [
  ...Object.values(PtyChannel),
  ...Object.values(UiChannel),
  ...Object.values(AgentChannel),
  ...Object.values(ShortcutChannel),
  ...Object.values(SlackChannelName),
  ...Object.values(JiraChannelName),
  ...Object.values(ConfluenceChannelName),
  ...Object.values(GoogleCalendarChannelName),
  ...Object.values(SessionChannel),
  ...Object.values(SettingsChannelName)
]

describe('IPC channel wire strings (modular contract)', () => {
  it('has no duplicate wire string across any domain module (FR-011, SC-006)', () => {
    expect(new Set(allWireStrings).size).toBe(allWireStrings.length)
  })

  it('every wire string is a non-empty string', () => {
    for (const value of allWireStrings) {
      expect(typeof value).toBe('string')
      expect(value.length).toBeGreaterThan(0)
    }
  })

  it('keeps SESSION_SCHEMA_VERSION at 8 (calendar-selection-persistence is additive — no bump)', () => {
    expect(SESSION_SCHEMA_VERSION).toBe(8)
  })
})
