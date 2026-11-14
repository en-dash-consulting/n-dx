/**
 * Groups the flat captures of a pack's `calls` query back into calls.
 *
 * The runner returns captures in document order without their match, so a
 * call's parts are paired by position, following the rules written in
 * `queries/<lang>/calls.scm`: a string argument belongs to the innermost
 * `@call.arguments` containing it, and a call's name is the `@call.name`
 * that ends exactly where its argument list starts.
 *
 * @module lang-runtime/pack-calls
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

const before = (a: SourcePosition, b: SourcePosition): boolean => a.line < b.line || (a.line === b.line && a.column < b.column);

/** Document order: start first, then the larger of two spans that start together. */
const outerFirst = (a: Capture, b: Capture): number =>
  before(a.start, b.start) ? -1 : before(b.start, a.start) ? 1 : before(b.end, a.end) ? -1 : before(a.end, b.end) ? 1 : 0;

const sameSpan = (a: Capture, b: Capture): boolean => samePosition(a.start, b.start) && samePosition(a.end, b.end);

/**
 * {@link innermost} for each of `captured`, in one sweep: for captures whose
 * spans nest or are disjoint, as syntax nodes' do, so a large file costs
 * n log n rather than n × m. `strict` skips an owner with the captured node's
 * own span (a list entry that is itself a list). Index i answers `captured[i]`.
 */
export function innermostEach(owners: readonly Capture[], captured: readonly Capture[], strict = false): (Capture | undefined)[] {
  const sortedOwners = [...owners].sort(outerFirst);
  const order = captured.map((_, i) => i).sort((a, b) => outerFirst(captured[a]!, captured[b]!));
  const result: (Capture | undefined)[] = new Array(captured.length);
  const open: Capture[] = [];
  let next = 0;
  for (const i of order) {
    const c = captured[i]!;
    // Open every owner that starts before c, or with it and no smaller: those that can contain c.
    for (; next < sortedOwners.length && outerFirst(sortedOwners[next]!, c) <= 0; next++) {
      const owner = sortedOwners[next]!;
      while (open.length > 0 && !contains(open.at(-1)!, owner)) open.pop();
      open.push(owner);
    }
    // An open owner that does not contain c ended before it, and so before every later capture.
    while (open.length > 0 && !contains(open.at(-1)!, c)) open.pop();
    let at = open.length - 1;
    if (strict) while (at >= 0 && sameSpan(open[at]!, c)) at--;
    result[i] = at >= 0 ? open[at] : undefined;
  }
  return result;
}

const stringArgument = (capture: Capture): StringArgument => ({ text: capture.text, start: capture.start, end: capture.end });

/** One call's captures, paired as {@link groupCalls} pairs them; for framework rules that need positions. */
export interface CallSite {
  /** The whole call, receiver included; absent when the query did not capture one. */
  readonly invocation?: Capture;
  readonly name?: Capture;
  readonly receiver?: Capture;
  readonly arguments: Capture;
  /** String literals passed directly to this call, in order. */
  readonly strings: readonly Capture[];
}

/**
 * Rebuild the calls of one file from its `calls` captures, as lang-kit calls
 * facts, in the order their argument lists open.
 *
 * An object creation is captured as `@call.construct`, and its class, when it
 * is a name, as `@call.class` directly inside it (PHP's `new Foo\Bar(…)`).
 * The call whose `@call.invocation` has the creation's span is marked
 * `construct`; a creation with no argument list (`new Foo`) is a call of its
 * own, with the class as callee and no strings, placed where its argument
 * list would open: after the class, or at `new` when the class is not a name
 * (`new $class`, an anonymous class).
 */
export function groupCalls(captures: readonly Capture[]): CallFact[] {
  const constructs = captures.filter((c) => c.name === "call.construct");
  const constructAt = new Map(constructs.map((c) => [spanKey(c), c]));
  const classes = captures.filter((c) => c.name === "call.class");
  const classOf = new Map<Capture, Capture>();
  innermostEach(constructs, classes).forEach((owner, i) => {
    if (owner && !classOf.has(owner)) classOf.set(owner, classes[i]!);
  });
  const calls: { readonly at: SourcePosition; readonly fact: CallFact }[] = [];
  const withList = new Set<Capture>();
  for (const site of callSites(captures)) {
    const construct = site.invocation ? constructAt.get(spanKey(site.invocation)) : undefined;
    if (construct) withList.add(construct);
    // A creation's class names it even when the name rule cannot pair it (`new Foo ($x)`).
    const callee = site.name ?? (construct ? classOf.get(construct) : undefined);
    calls.push({
      at: site.arguments.start,
      fact: {
        ...(callee ? { callee: callee.text } : {}),
        ...(site.receiver ? { receiver: site.receiver.text } : {}),
        ...(construct ? { construct: true } : {}),
        strings: site.strings.map(stringArgument),
      },
    });
  }
  const bare = constructs.filter((c) => !withList.has(c));
  if (bare.length === 0) return calls.map((c) => c.fact);

  for (const construct of bare) {
    const cls = classOf.get(construct);
    calls.push({
      at: cls ? cls.end : construct.start,
      fact: { ...(cls ? { callee: cls.text } : {}), construct: true, strings: [] },
    });
  }
  // Stable: calls that open together keep their order.
  return calls.sort((a, b) => (before(a.at, b.at) ? -1 : before(b.at, a.at) ? 1 : 0)).map((c) => c.fact);
}

const spanKey = (c: Capture): string => `${c.start.line}:${c.start.column}-${c.end.line}:${c.end.column}`;

/** The calls of one file from its `calls` captures, one per argument list in document order. */
export function callSites(captures: readonly Capture[]): CallSite[] {
  const named = (name: string): Capture[] => captures.filter((c) => c.name === name);
  const invocations = named("call.invocation");
  const names = named("call.name");
  const receivers = named("call.receiver");
  const argumentLists = named("call.arguments");
  const strings = named("call.string_argument");

  // Each string's owner, in one sweep, so a file with many calls stays n log n.
  const stringsByList = new Map<Capture, Capture[]>();
  const owners = innermostEach(argumentLists, strings);
  strings.forEach((s, i) => {
    const owner = owners[i];
    if (!owner) return;
    const list = stringsByList.get(owner);
    if (list) list.push(s);
    else stringsByList.set(owner, [s]);
  });

  // Candidates by position, each bucket in document order, so a lookup is not a scan of the file.
  const key = (p: SourcePosition): string => `${p.line}:${p.column}`;
  const bucket = (captures: readonly Capture[], at: (c: Capture) => SourcePosition): Map<string, Capture[]> => {
    const map = new Map<string, Capture[]>();
    for (const c of captures) {
      const k = key(at(c));
      const list = map.get(k);
      if (list) list.push(c);
      else map.set(k, [c]);
    }
    return map;
  };
  const invocationsByEnd = bucket(invocations, (c) => c.end);
  const namesByEnd = bucket(names, (c) => c.end);
  const receiversByStart = bucket(receivers, (c) => c.start);

  return argumentLists.map((list) => {
    // The invocation that closes where this list closes; the next one out ends later.
    const invocation = invocationsByEnd.get(key(list.end))?.find((i) => contains(i, list));
    const name = namesByEnd.get(key(list.start))?.find((n) => !invocation || contains(invocation, n));
    // In a chain (`a.b().c()`) several receivers start with the invocation; this call's ends last before its name.
    let receiver: Capture | undefined;
    if (name && invocation) {
      for (const r of receiversByStart.get(key(invocation.start)) ?? []) {
        if (atOrBefore(r.end, name.start) && (receiver === undefined || before(receiver.end, r.end))) receiver = r;
      }
    }
    return {
      ...(invocation ? { invocation } : {}),
      ...(name ? { name } : {}),
      ...(receiver ? { receiver } : {}),
      arguments: list,
      strings: stringsByList.get(list) ?? [],
    };
  });
}
