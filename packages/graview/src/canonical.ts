/**
 * Canonical JSON: object keys sorted at every depth, two-space indent, a
 * trailing newline. Two projections of an unchanged checkout must be
 * byte-identical, so the writer cannot depend on insertion order anywhere.
 * Arrays keep their order; the builder sorts them before they get here.
 */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/** Compare two strings the way the canonical sort does everywhere. */
export function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
