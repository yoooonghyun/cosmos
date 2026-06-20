/**
 * pathConfine — the PURE, node-testable path-confinement guard for the Terminal File
 * Explorer (terminal-file-explorer-v1, FR-019/FR-020/FR-021). No Electron, no React
 * import (the `.ts`/`.test.ts` split) — the load-bearing security boundary is unit-
 * tested directly.
 *
 * Every directory-list, file-read, and image-stream request is confined to INSIDE the
 * tab's root: the renderer supplies only a root-RELATIVE path (`relPath`); main looks
 * up the root (by `paneId`, never trusting a renderer-supplied root — FR-022) and calls
 * {@link confine} to resolve + validate the joined target. The check is done on the
 * CANONICAL (real) on-disk paths of BOTH the root and the target so a symlink (or a path
 * through a symlinked ancestor) whose real target lies outside the root is refused
 * (FR-021 — the subtle case). `..` traversal and absolute-path escapes are rejected too,
 * evaluated AFTER `path.resolve` normalization (FR-020).
 *
 * `confine` injects its filesystem real-path + lstat probes so it stays a pure function
 * of (root, relPath, fs-probes) and is exercised without touching the real disk in the
 * common cases; the Electron/protocol callers pass the real `fs` adapters.
 */

import { isAbsolute, resolve, sep } from 'node:path'

/**
 * Why a target was refused (mapped to `FsFailureReason` by the caller). `out-of-root`
 * covers a `..`/absolute escape AND a symlink-escape AND a missing root (no live pane);
 * `not-found` is a target that does not exist on disk.
 */
export type ConfineFailure = 'out-of-root' | 'not-found'

/** The outcome of a confinement check. On success, `abs` is the CANONICAL absolute path
 * inside the root, safe to read/list. On failure, `reason` says why (never an `abs`). */
export type ConfineResult =
  | { ok: true; abs: string }
  | { ok: false; reason: ConfineFailure }

/**
 * Injected filesystem probes so {@link confine} is pure w.r.t. its inputs (testable
 * without the real disk). `realpath` returns the canonical (symlink-resolved) absolute
 * path of an existing path, or throws/returns null when the path does not exist. The
 * protocol/explorer callers wire these to `fs.realpathSync` (with a graceful catch).
 */
export interface ConfineFs {
  /** Canonical real path of `p` (symlinks resolved), or `null` if it does not exist /
   * cannot be resolved. MUST NOT throw — a missing path is `null`, not an exception. */
  realpath(p: string): string | null
}

/**
 * Confine a renderer-supplied root-relative `relPath` to within `root` (FR-019/020/021).
 *
 * Algorithm:
 *  1. Reject a non-string / absolute / NUL-bearing `relPath` outright (FR-020) — the
 *     renderer must only ever send a relative path; an absolute one is an escape attempt.
 *  2. `path.resolve(root, relPath)` — normalizes away `.`/`..` segments lexically.
 *  3. Real-path the ROOT (canonical, symlinks resolved). A root that does not resolve
 *     (deleted / no live pane) → `out-of-root` (nothing to confine to).
 *  4. Real-path the TARGET. If it exists, the containment check uses its REAL path so a
 *     symlink whose target is outside the canonical root is refused (FR-021). If it does
 *     NOT exist yet (e.g. a freshly-created entry mid-watch), fall back to the lexically-
 *     resolved path for the containment check, then report `not-found` only AFTER it
 *     passes containment (so a non-existent IN-root path is `not-found`, an out-of-root
 *     one is `out-of-root` — we never leak existence of an out-of-root path).
 *  5. Containment: the (real) target must equal the (real) root or sit under `root + sep`
 *     — a prefix check on the canonical paths, so neither `..` nor a symlink can escape.
 *
 * Pure; never throws (probe errors are swallowed by the injected `realpath` returning
 * null). The empty `relPath` (`''`) resolves to the root itself and is accepted.
 */
export function confine(root: string, relPath: unknown, fs: ConfineFs): ConfineResult {
  if (typeof root !== 'string' || root === '' || !isAbsolute(root)) {
    // No usable root (no live pane / not an absolute dir) — nothing to confine to.
    return { ok: false, reason: 'out-of-root' }
  }
  if (typeof relPath !== 'string') {
    return { ok: false, reason: 'out-of-root' }
  }
  // A NUL byte truncates paths in many syscalls — reject outright (FR-020/FR-023).
  if (relPath.includes('\0')) {
    return { ok: false, reason: 'out-of-root' }
  }
  // An ABSOLUTE relPath is an escape attempt — the renderer must only send relatives.
  // (path.resolve would otherwise discard the root and honor the absolute path.)
  if (isAbsolute(relPath)) {
    return { ok: false, reason: 'out-of-root' }
  }

  // Canonicalize the root. A root that no longer resolves → out-of-root (FR-019).
  const realRoot = fs.realpath(root)
  if (realRoot === null) {
    return { ok: false, reason: 'out-of-root' }
  }

  // Lexically resolve the target (collapses `.`/`..`). This alone does NOT defeat a
  // symlink escape — that needs the real-path check below.
  const lexicalTarget = resolve(realRoot, relPath)

  // Real-path the target. If it exists, use its CANONICAL path for containment so a
  // symlink (or symlinked ancestor) whose real target escapes the root is refused
  // (FR-021). If it does not exist, fall back to the lexical path and report not-found
  // ONLY after it passes containment.
  const realTarget = fs.realpath(lexicalTarget)
  const checkPath = realTarget ?? lexicalTarget

  if (!isWithin(realRoot, checkPath)) {
    return { ok: false, reason: 'out-of-root' }
  }
  if (realTarget === null) {
    // In-root but absent on disk (e.g. deleted while open / freshly removed).
    return { ok: false, reason: 'not-found' }
  }
  return { ok: true, abs: realTarget }
}

/**
 * True iff `child` is `root` itself or lies under `root`. Compares canonical absolute
 * paths with a trailing-separator prefix test so `/a/rootEVIL` is NOT considered under
 * `/a/root`. Pure.
 */
export function isWithin(root: string, child: string): boolean {
  if (typeof root !== 'string' || typeof child !== 'string' || root === '' || child === '') {
    return false
  }
  if (child === root) {
    return true
  }
  // Guard the boundary with the platform separator so `/a/root` does not contain
  // `/a/rootx`. A root that already ends in `sep` (e.g. a drive root `C:\`) is handled
  // by not doubling it.
  const rootWithSep = root.endsWith(sep) ? root : root + sep
  return child.startsWith(rootWithSep)
}
