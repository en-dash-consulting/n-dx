/**
 * CODEOWNERS, read for the reviewer of a PR's files. The first of
 * `.github/CODEOWNERS`, `CODEOWNERS` and `docs/CODEOWNERS` that exists is the
 * file, as GitHub reads it; the last rule that matches a path wins.
 *
 * Patterns follow gitignore's shape: `*` stays inside a segment, `**` crosses
 * segments, a leading `/` anchors at the root, a trailing `/` names a
 * directory, and a pattern with no `/` matches at any depth. Negation and
 * character classes are not CODEOWNERS syntax and are not handled.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface CodeownersRule {
  pattern: RegExp;
  owners: string[];
}

const LOCATIONS = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];

function patternToRegExp(raw: string): RegExp {
  const anchored = raw.startsWith("/") || raw.slice(0, -1).includes("/");
  const directory = raw.endsWith("/");
  const body = raw.replace(/^\/+/, "").replace(/\/+$/, "");
  const source = body
    .split("/")
    .map((segment) => (segment === "**" ? ".*" : segment.replace(/[.+^${}()|[\]\\?]/g, "\\$&").replace(/\*/g, "[^/]*")))
    .join("/")
    .replace(/\/\.\*\//g, "/(?:.*/)?");
  const prefix = anchored ? "^" : "^(?:.*/)?";
  return new RegExp(`${prefix}${source}${directory ? "/.*" : "(?:/.*)?"}$`);
}

/** The rules `text` holds, in file order. A rule naming no owner un-owns its paths. */
export function parseCodeowners(text: string): CodeownersRule[] {
  return text.split("\n").flatMap((line) => {
    const [pattern, ...owners] = line.replace(/\s#.*$/, "").trim().split(/\s+/);
    if (!pattern || pattern.startsWith("#")) return [];
    return [{ pattern: patternToRegExp(pattern), owners }];
  });
}

/** The project's rules, or none when it has no CODEOWNERS file. */
export function readCodeowners(projectDir: string): CodeownersRule[] {
  const file = LOCATIONS.map((location) => join(projectDir, location)).find((path) => existsSync(path));
  return file ? parseCodeowners(readFileSync(file, "utf-8")) : [];
}

/** The first owner of the first of `files` that has one, or undefined. */
export function ownerOfFiles(rules: readonly CodeownersRule[], files: readonly string[]): string | undefined {
  for (const file of files) {
    const rule = [...rules].reverse().find((r) => r.pattern.test(file));
    if (rule?.owners[0]) return rule.owners[0];
  }
  return undefined;
}
