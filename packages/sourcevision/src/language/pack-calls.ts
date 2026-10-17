/**
 * Groups the flat captures of a pack's `calls` query back into calls.
 *
 * The runner returns captures in document order without their match, so a
 * call's parts are paired by position, following the rules written in
 * `queries/<lang>/calls.scm`: a string argument belongs to the innermost
 * `@call.arguments` containing it, and a call's name is the `@call.name`
 * that ends exactly where its argument list starts.
 *
 * @module sourcevision/language/pack-calls
 */

import type { CallFact, StringArgument } from "@n-dx/lang-kit";
import type { Capture, SourcePosition } from "./pack.js";

export const atOrBefore = (a: SourcePosition, b: SourcePosition): boolean =>
  a.line < b.line || (a.line === b.line && a.column <= b.column);

const samePosition = (a: SourcePosition, b: SourcePosition): boolean => a.line === b.line && a.column === b.column;

/** True when `inner` lies within `outer`. */
export const contains = (outer: Capture, inner: Capture): boolean =>
  atOrBefore(outer.start, inner.start) && atOrBefore(inner.end, outer.end);

/** The smallest of `candidates` that contains `inner`. */
export function innermost(candidates: readonly Capture[], inner: Capture): Capture | undefined {
  let best: Capture | undefined;
  for (const candidate of candidates) {
    if (!contains(candidate, inner)) continue;
    if (best === undefined || contains(best, candidate)) best = candidate;
  }
  return best;
}

const stringArgument = (capture: Capture): StringArgument => ({ text: capture.text, start: capture.start, end: capture.end });

/** Rebuild the calls of one file from its `calls` captures, as lang-kit calls facts. */
export function groupCalls(captures: readonly Capture[]): CallFact[] {
  const named = (name: string): Capture[] => captures.filter((c) => c.name === name);
  const invocations = named("call.invocation");
  const names = named("call.name");
  const receivers = named("call.receiver");
  const argumentLists = named("call.arguments");
  const strings = named("call.string_argument");

  // Each string's owner once, so a file with many calls stays linear in strings × lists.
  const stringsByList = new Map<Capture, Capture[]>();
  for (const s of strings) {
    const owner = innermost(argumentLists, s);
    if (owner) stringsByList.set(owner, [...(stringsByList.get(owner) ?? []), s]);
  }

  return argumentLists.map((list) => {
    // The invocation that closes where this list closes; the next one out ends later.
    const invocation = invocations.find((i) => samePosition(i.end, list.end) && contains(i, list));
    const name = names.find((n) => samePosition(n.end, list.start) && (!invocation || contains(invocation, n)));
    const receiver = name
      ? receivers.find((r) => invocation !== undefined && samePosition(r.start, invocation.start) && atOrBefore(r.end, name.start))
      : undefined;
    return {
      ...(name ? { callee: name.text } : {}),
      ...(receiver ? { receiver: receiver.text } : {}),
      strings: (stringsByList.get(list) ?? []).map(stringArgument),
    };
  });
}
