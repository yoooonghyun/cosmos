/**
 * Shared validator predicates + the injectable `warn` helper.
 *
 * These were module-private in the monolithic `validate.ts`; they are promoted to
 * exports here so every per-domain `<domain>.validate.ts` imports them DOWNWARD (no
 * duplication — FR-014). Re-exported (unchanged) through the `src/shared/validate.ts`
 * barrel.
 */

/** Logger shape used for warnings. Injectable for tests. */
export type WarnFn = (message: string, ...args: unknown[]) => void

export const defaultWarn: WarnFn = (message, ...args) => console.warn(message, ...args)

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export function optionalCursorOk(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}
