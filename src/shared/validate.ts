/**
 * Pure, side-effect-light validators for inbound IPC payloads (FR-010, SC-005) —
 * the single authoritative validator surface.
 *
 * The main process MUST validate inbound IPC payloads (input/resize); an invalid
 * or missing required field MUST log a warning and be safely ignored (no crash).
 *
 * These functions are pure with respect to input -> result, and report problems
 * through an injectable `warn` callback so they can be unit-tested without
 * touching the real console. The default `warn` is `console.warn`.
 *
 * This module is now a thin **barrel** that re-exports the per-domain validator
 * modules co-located under `src/shared/ipc/<domain>.validate.ts`. The validators are
 * physically split per domain (so a validator-only edit and a contract-only edit land
 * in different files) but logically single — every importer keeps importing from
 * `'../shared/validate'` / `'./validate'`, unchanged. The shared predicates
 * (`isObject`/`isNonEmptyString`/`isPositiveInt`/`optionalCursorOk`) +
 * `WarnFn`/`defaultWarn` live in `./ipc/common.validate` and are imported (never
 * duplicated) by every domain validator.
 */

export * from './ipc/common.validate'
export * from './ipc/pty.validate'
export * from './ipc/fs.validate'
export * from './ipc/ui.validate'
export * from './ipc/adapter.validate'
export * from './ipc/agent.validate'
export * from './ipc/slack.validate'
export * from './ipc/jira.validate'
export * from './ipc/confluence.validate'
export * from './ipc/googleCalendar.validate'
export * from './ipc/settings.validate'
