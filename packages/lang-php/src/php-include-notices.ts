/**
 * Dynamic includes: an include whose path is not computable
 * (`php-includes.ts`) gives no edge, so the pack counts it in a project
 * notice with its location, never guessing a target. One whose path reads
 * the request's host name (`$_SERVER['HTTP_HOST']` or
 * `$_SERVER['SERVER_NAME']`, the usual way a multi-tenant legacy site picks
 * its tenant's configuration) is counted under its own code instead.
 *
 * @module lang-php/php-include-notices
 */

import type { SourcePosition } from "@n-dx/lang-kit";
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
}

/** `$_SERVER['HTTP_HOST']`, `$_SERVER["SERVER_NAME"]`, or `$_SERVER[HTTP_HOST]` inside a double-quoted string. */
const HOST = /\$_SERVER\s*\[\s*(['"]?)(HTTP_HOST|SERVER_NAME)\1\s*\]/;

/** Whether an include's path expression reads the request's host name. */
export const isHostInclude = (specifier: string): boolean => HOST.test(specifier);

/** How many locations a notice names before the rest are counted. */
const NOTICE_LOCATIONS = 5;

/** `subject` says what one include, or several, do: "include builds its path", "includes build their path". */
function notice(code: string, found: readonly DynamicInclude[], subject: (one: boolean) => string): string | undefined {
  if (found.length === 0) return undefined;
  const one = found.length === 1;
  const where = found.slice(0, NOTICE_LOCATIONS).map((d) => `${d.path}:${d.position.line}`);
  const more = found.length > NOTICE_LOCATIONS ? `, and ${found.length - NOTICE_LOCATIONS} more` : "";
  const listed = found.filter((d) => d.candidates !== undefined);
  const cut = listed.filter((d) => d.candidates!.total > d.candidates!.files.length).length;
  const cutNote = cut === 0 ? "" : ` (${cut} cut at ${MAX_INCLUDE_CANDIDATES} files)`;
  const candidates = listed.length === 0 ? "" : `; ${listed.length} with candidate files, never edges${cutNote}`;
  return `[${code}] ${found.length} ${subject(one)} and give${one ? "s" : ""} no edge: ${where.join(", ")}${more}${candidates}.`;
}

/** The notices for a project's dynamic includes, host-based ones apart; empty when there are none. */
export function dynamicIncludeNotices(found: readonly DynamicInclude[]): string[] {
  const host = found.filter((d) => isHostInclude(d.specifier));
  const other = found.filter((d) => !isHostInclude(d.specifier));
  return [
    notice(PHP_DYNAMIC_INCLUDE, other, (one) => (one ? "include builds its path at run time" : "includes build their path at run time")),
    notice(PHP_HOST_INCLUDE, host, (one) => (one ? "include chooses its file by the request's host name" : "includes choose their file by the request's host name")),
  ].filter((n): n is string => n !== undefined);
}
