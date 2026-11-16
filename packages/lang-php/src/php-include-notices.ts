/**
 * Dynamic includes: an include whose path is not computable
 * (`php-includes.ts`) gives no edge, so the pack counts it in a project
 * notice with its location, never guessing a target. One whose path reads
 * the request's host name (`$_SERVER['HTTP_HOST']` or
 * `$_SERVER['SERVER_NAME']`, the usual way a multi-tenant legacy site picks
 * its tenant's configuration) is counted under its own code instead, whether
 * it reads it in the path or through a variable (`$host = $_SERVER['HTTP_HOST'];
 * include "config/$host.php";`).
 *
 * @module lang-php/php-include-notices
 */

import type { SourcePosition } from "@n-dx/lang-kit";
import type { Capture, PackSourceFile } from "@n-dx/lang-runtime";
import { before, readAssignments, scopeAt } from "./php-assignments.js";
import { MAX_INCLUDE_CANDIDATES, type PhpIncludeCandidates } from "./php-includes.js";

/** The notice code of includes whose path is not computable. */
export const PHP_DYNAMIC_INCLUDE = "php-dynamic-include";
/** The notice code of includes whose path reads the request's host name. */
export const PHP_HOST_INCLUDE = "php-host-include";

/** One include whose path is not computable. */
export interface DynamicInclude {
  readonly path: string;
  readonly position: SourcePosition;
  /** The path expression as written. */
  readonly specifier: string;
  readonly candidates?: PhpIncludeCandidates;
  /** Whether the path reads the request's host name (`hostReader`). */
  readonly host: boolean;
}

/** `$_SERVER['HTTP_HOST']`, `$_SERVER["SERVER_NAME"]`, or `$_SERVER[HTTP_HOST]` inside a double-quoted string. */
const HOST = /\$_SERVER\s*\[\s*(['"]?)(HTTP_HOST|SERVER_NAME)\1\s*\]/;

/** The variables an expression reads, without `$`: `$name`, `{$name}`, `${name}`. */
const VARIABLE = /\$\{?([A-Za-z_]\w*)/g;

/**
 * Whether an include of `file`, its path expression `specifier` at `at`,
 * reads the request's host name: in the path itself, or through a variable
 * whose last assignment before the include, in the include's scope (the
 * function, method or closure body holding it, or the file), reads it —
 * directly, through a call (`strtolower($_SERVER['SERVER_NAME'])`) or through
 * another such variable. `.=` keeps what the variable held. Another variable
 * named alike in another scope, or a host read elsewhere in the file, does
 * not count.
 */
export function hostReader(file: PackSourceFile): (specifier: string, at: SourcePosition) => boolean {
  const assignments = readAssignments(file).map((a) => ({ ...a, scope: scopeAt(file, a.start) }));
  /** Keyed by name and position, which fix the scope: a variable reassigned from itself is read once per assignment. */
  const memo = new Map<string, boolean>();
  const variable = (name: string, at: SourcePosition, scope: Capture | undefined): boolean => {
    const key = `${name}@${at.line}:${at.column}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    let host = false;
    for (const a of assignments) {
      if (!before(a.start, at)) break;
      if (a.name !== name || a.scope !== scope) continue;
      const assigned = a.value !== undefined && reads(a.value, a.start, scope);
      host = a.operator === undefined ? assigned : host || assigned;
    }
    memo.set(key, host);
    return host;
  };
  const reads = (text: string, at: SourcePosition, scope: Capture | undefined): boolean =>
    HOST.test(text) || [...text.matchAll(VARIABLE)].some((m) => variable(m[1]!, at, scope));
  return (specifier, at) => reads(specifier, at, scopeAt(file, at));
}

/** How many locations a notice names before the rest are counted. */
const NOTICE_LOCATIONS = 5;

/** The first locations of `found` as `file:line`, the rest counted: `a.php:3, b.php:9, and 4 more`. */
export function noticeLocations(found: readonly { readonly path: string; readonly position: SourcePosition }[]): string {
  const where = found.slice(0, NOTICE_LOCATIONS).map((d) => `${d.path}:${d.position.line}`);
  const more = found.length > NOTICE_LOCATIONS ? `, and ${found.length - NOTICE_LOCATIONS} more` : "";
  return `${where.join(", ")}${more}`;
}

/** `subject` says what one include, or several, do: "include builds its path", "includes build their path". */
function notice(code: string, found: readonly DynamicInclude[], subject: (one: boolean) => string): string | undefined {
  if (found.length === 0) return undefined;
  const one = found.length === 1;
  const listed = found.filter((d) => d.candidates !== undefined);
  const cut = listed.filter((d) => d.candidates!.total > d.candidates!.files.length).length;
  const cutNote = cut === 0 ? "" : ` (${cut} cut at ${MAX_INCLUDE_CANDIDATES} files)`;
  const candidates = listed.length === 0 ? "" : `; ${listed.length} with candidate files, never edges${cutNote}`;
  return `[${code}] ${found.length} ${subject(one)} and give${one ? "s" : ""} no edge: ${noticeLocations(found)}${candidates}.`;
}

/** The notices for a project's dynamic includes, host-based ones apart; empty when there are none. */
export function dynamicIncludeNotices(found: readonly DynamicInclude[]): string[] {
  const host = found.filter((d) => d.host);
  const other = found.filter((d) => !d.host);
  return [
    notice(PHP_DYNAMIC_INCLUDE, other, (one) => (one ? "include builds its path at run time" : "includes build their path at run time")),
    notice(PHP_HOST_INCLUDE, host, (one) => (one ? "include chooses its file by the request's host name" : "includes choose their file by the request's host name")),
  ].filter((n): n is string => n !== undefined);
}
