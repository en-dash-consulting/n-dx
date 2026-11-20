/**
 * The selection and expansion sets the components keep in state change by
 * copy, never in place, so Preact sees a new value. `toggled` is that copy
 * with one member flipped.
 */

/** A copy of `set` with `value` added, or removed when it was there. */
export function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
