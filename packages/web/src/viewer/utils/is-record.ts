/**
 * The plain-object guard the viewer's JSON readers share: the Sidecar
 * external-call form's schema walk and the Live tracker's activity reader.
 * It mirrors `src/shared/is-record.ts`, which the viewer reaches only through
 * `external.ts`, already at its export ceiling.
 *
 * @module web/viewer/utils/is-record
 */

/** Whether `value` is a non-null object that is not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
