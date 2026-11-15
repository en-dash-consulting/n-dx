/**
 * The plain-object guard the server's JSON readers share. Config files,
 * tracker payloads and Sidecar call arguments all arrive as `unknown` and are
 * read field by field once this has passed.
 *
 * @module web/server/is-record
 */

/** Whether `value` is a non-null object that is not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
