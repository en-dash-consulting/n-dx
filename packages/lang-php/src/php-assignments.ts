/**
 * Assignments to plain variables and the scopes they live in, read from the
 * `imports` and `guards` captures (`queries/php/`): what a variable in an
 * include's path held, for autoloader patterns (`php-autoloaders.ts`) and
 * host-based includes (`php-include-notices.ts`).
 *
 * @module lang-php/php-assignments
 */

import type { SourcePosition } from "@n-dx/lang-kit";
import type { Capture, PackSourceFile } from "@n-dx/lang-runtime";
import { owned } from "./php-includes.js";

export const before = (a: SourcePosition, b: SourcePosition): boolean => a.line < b.line || (a.line === b.line && a.column < b.column);

export const inside = (span: Capture, at: SourcePosition): boolean => !before(at, span.start) && before(at, span.end);

/** A variable's name without its `$`. */
export const variableName = (text: string): string => text.replace(/^\$/, "");

export interface Assignment {
  readonly name: string;
  /** A compound operator (`.=`); undefined for `=`. */
  readonly operator?: string;
  /** The right-hand side as written; undefined when it cannot build a path (an array, a closure, `new`). */
  readonly value?: string;
  readonly start: SourcePosition;
}

/** A file's assignments to plain variables, in document order. */
export function readAssignments(file: PackSourceFile): Assignment[] {
  const imports = file.captures.imports ?? [];
  const names = owned(imports, "include.assign", "include.assigned");
  const values = owned(imports, "include.assign", "include.assign_value");
  const operators = owned(imports, "include.assign", "include.assign_operator");
  const assignments: Assignment[] = [];
  const valued = new Set<string>();
  for (const [assign, name] of names) {
    const value = values.get(assign);
    if (value === undefined) continue;
    const operator = operators.get(assign)?.text;
    valued.add(`${assign.start.line}:${assign.start.column}`);
    assignments.push({ name: variableName(name.text), value: value.text, start: assign.start, ...(operator !== undefined && { operator }) });
  }
  // Any other assignment (its variable alone, which starts where the assignment does) leaves the value unknown.
  for (const target of imports) {
    if (target.name === "include.reassigned" && !valued.has(`${target.start.line}:${target.start.column}`)) {
      assignments.push({ name: variableName(target.text), start: target.start });
    }
  }
  return assignments.sort((a, b) => (before(a.start, b.start) ? -1 : before(b.start, a.start) ? 1 : 0));
}

/**
 * The variable scope at `at`: the innermost function, method, closure or
 * arrow function body holding it, undefined for the file's own scope.
 */
export function scopeAt(file: PackSourceFile, at: SourcePosition): Capture | undefined {
  let found: Capture | undefined;
  for (const body of file.captures.guards ?? []) {
    if (body.name === "guard.function" && inside(body, at) && (found === undefined || before(found.start, body.start))) found = body;
  }
  return found;
}
