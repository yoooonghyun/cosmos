import { describe, it, expect } from 'vitest'
import {
  matchesCosmosMcpServer,
  isOrphanedMcpServer,
  selectOrphanMcpServers,
  type CosmosMcpSignature,
  type ProcSnapshotRow
} from './orphanReaper'

/**
 * session-resume-relaunch-v4 — startup orphan reaper. The PURE predicate that, given a process-table
 * snapshot + THIS install's signature, selects orphaned cosmos MCP-server pids to SIGKILL. The three
 * safety gates (signature match · genuinely orphaned · pid > 1) are pinned here; live-owned and
 * different-install servers must be left untouched.
 */

const OUT = '/Apps/cosmos.app/Contents/Resources/out/main/mcp/'
const SANDBOX = '/Users/me/Library/Application Support/cosmos/sandbox'
const SIG: CosmosMcpSignature = { outDirMarker: OUT, sandboxMarker: SANDBOX }

/** A cosmos MCP-server command line (env-augmented `ps -E`), defaulting to this install's signature. */
function serverCmd(script = 'renderUiServer.js', socketDir = SANDBOX): string {
  return `node ${OUT}${script} COSMOS_BRIDGE_SOCKET=${socketDir}/.cosmos-render-ui.sock`
}

function row(p: Partial<ProcSnapshotRow> & { pid: number }): ProcSnapshotRow {
  return { ppid: 1, pgid: p.pid, command: serverCmd(), ...p }
}

describe('matchesCosmosMcpServer (command + socket signature)', () => {
  it('matches one of OUR server scripts bound to THIS install socket', () => {
    expect(matchesCosmosMcpServer(row({ pid: 100 }), SIG)).toBe(true)
    expect(
      matchesCosmosMcpServer(row({ pid: 101, command: serverCmd('jiraRenderUiServer.js') }), SIG)
    ).toBe(true)
  })

  it('does NOT match a server from a DIFFERENT checkout (other out dir)', () => {
    const other = `node /other/checkout/out/main/mcp/renderUiServer.js COSMOS_BRIDGE_SOCKET=${SANDBOX}/.cosmos-render-ui.sock`
    expect(matchesCosmosMcpServer(row({ pid: 102, command: other }), SIG)).toBe(false)
  })

  it('does NOT match a DIFFERENT install instance (different sandbox socket dir)', () => {
    const otherSock = serverCmd('renderUiServer.js', '/Users/other/Library/Application Support/cosmos/sandbox')
    expect(matchesCosmosMcpServer(row({ pid: 103, command: otherSock }), SIG)).toBe(false)
  })

  it('does NOT match an unrelated node process under our out dir (no *Server.js)', () => {
    const unrelated = `node ${OUT}helper.js COSMOS_BRIDGE_SOCKET=${SANDBOX}/.cosmos-render-ui.sock`
    expect(matchesCosmosMcpServer(row({ pid: 104, command: unrelated }), SIG)).toBe(false)
  })

  it('does NOT match an empty command or a degenerate empty sandbox marker', () => {
    expect(matchesCosmosMcpServer(row({ pid: 105, command: '' }), SIG)).toBe(false)
    expect(
      matchesCosmosMcpServer(row({ pid: 106 }), { outDirMarker: OUT, sandboxMarker: '' })
    ).toBe(false)
  })

  it('matches across a sandbox path containing spaces (macOS userData)', () => {
    // The socket appears in the env-augmented command line; the marker is matched as a substring so
    // a space in "Application Support" does not break the match.
    expect(matchesCosmosMcpServer(row({ pid: 107 }), SIG)).toBe(true)
  })
})

describe('isOrphanedMcpServer', () => {
  it('is orphaned when reparented to launchd (ppid === 1)', () => {
    expect(isOrphanedMcpServer(row({ pid: 200, ppid: 1 }), new Set([200]))).toBe(true)
  })

  it('is orphaned when its parent claude is no longer alive in the snapshot', () => {
    // ppid 999 (a dead claude) is not among the live pids.
    expect(isOrphanedMcpServer(row({ pid: 201, ppid: 999 }), new Set([201]))).toBe(true)
  })

  it('is NOT orphaned when its parent claude is still alive', () => {
    // ppid 500 IS live → a running session owns it.
    expect(isOrphanedMcpServer(row({ pid: 202, ppid: 500 }), new Set([202, 500]))).toBe(false)
  })
})

describe('selectOrphanMcpServers (the reaper decision)', () => {
  it('selects an orphaned cosmos server (ppid===1) but never a pid <= 1', () => {
    const snap = [row({ pid: 300, ppid: 1 })]
    expect(selectOrphanMcpServers(snap, SIG)).toEqual([300])
  })

  it('SKIPS a live-owned server (parent claude alive) — concurrent cosmos untouched', () => {
    const snap = [
      // a live claude (not one of our scripts) and its child server
      { pid: 600, ppid: 1, pgid: 600, command: 'claude --mcp-config {…}' },
      row({ pid: 601, ppid: 600 }) // parent 600 is alive → owned, skip
    ]
    expect(selectOrphanMcpServers(snap, SIG)).toEqual([])
  })

  it('SKIPS a different-install / different-checkout server even if orphaned', () => {
    const snap = [
      row({ pid: 700, ppid: 1, command: serverCmd('renderUiServer.js', '/Users/other/sandbox') }),
      row({
        pid: 701,
        ppid: 1,
        command: `node /other/out/main/mcp/jiraMcpServer.js COSMOS_JIRA_BRIDGE_SOCKET=${SANDBOX}/.cosmos-jira.sock`
      })
    ]
    expect(selectOrphanMcpServers(snap, SIG)).toEqual([])
  })

  it('matches the ppid!=1-but-leader-dead case (orphan), not the leader-alive case', () => {
    const snap = [
      row({ pid: 801, ppid: 9999 }), // parent 9999 not in snapshot → leader dead → orphan
      { pid: 802, ppid: 1, pgid: 802, command: 'claude …' }, // a live claude
      row({ pid: 803, ppid: 802 }) // parent 802 alive → owned, skip
    ]
    expect(selectOrphanMcpServers(snap, SIG)).toEqual([801])
  })

  it('selects ALL of a dead claude\'s orphaned servers, deduped + ascending', () => {
    const snap = [
      row({ pid: 905, ppid: 1, command: serverCmd('slackMcpServer.js') }),
      row({ pid: 901, ppid: 1, command: serverCmd('jiraMcpServer.js') }),
      row({ pid: 903, ppid: 1, command: serverCmd('confluenceMcpServer.js') })
    ]
    expect(selectOrphanMcpServers(snap, SIG)).toEqual([901, 903, 905])
  })

  it('returns empty for an empty snapshot (nothing to reap, no crash)', () => {
    expect(selectOrphanMcpServers([], SIG)).toEqual([])
  })

  it('never selects pid 0 or 1 even if they (impossibly) matched', () => {
    const snap = [
      { pid: 1, ppid: 1, pgid: 1, command: serverCmd() },
      { pid: 0, ppid: 1, pgid: 0, command: serverCmd() }
    ]
    expect(selectOrphanMcpServers(snap, SIG)).toEqual([])
  })
})
