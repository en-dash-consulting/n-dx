/**
 * Minified bundles: committed third-party or build output (jQuery, plugins,
 * built front ends), never code to map. The inventory gives them role
 * `generated`; the call graph leaves them out unless `--include-minified`.
 */

import { extname } from "node:path";
import type { FileRole } from "../schema/index.js";

/**
 * Roles the call graph and the components phase never parse: build output,
 * bundles and served assets. `--include-minified` brings minified ones back
 * into the call graph.
 */
export const UNMAPPED_ROLES: ReadonlySet<FileRole> = new Set<FileRole>(["generated", "asset"]);

/** Names that mark a minified file or a bundle's source map. */
const MINIFIED_NAME_PATTERNS: readonly RegExp[] = [
  /\.min\.(?:js|mjs|cjs|css)$/i,
  /-min\.js$/i,
  /\.bundle\.js$/i,
  /\.(?:js|mjs|cjs|css)\.map$/i,
];

/** Extensions whose content is checked for a minified line when the name does not say. */
const MINIFIED_CONTENT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".css"]);

/** Bytes of a file's start the content check reads. */
export const MINIFIED_HEAD_BYTES = 64 * 1024;

/** A line longer than this in the head marks the file minified. */
export const MINIFIED_LINE_CHARS = 2000;

/** Rules that decide minified files, for cache fingerprints. */
export const MINIFIED_RULES = {
  names: MINIFIED_NAME_PATTERNS.map((p) => p.source),
  contentExtensions: [...MINIFIED_CONTENT_EXTENSIONS],
  headBytes: MINIFIED_HEAD_BYTES,
  lineChars: MINIFIED_LINE_CHARS,
} as const;

/** True when the name marks `filePath` minified (`*.min.js`, `*-min.js`, `*.bundle.js`, a source map). */
export function isMinifiedName(filePath: string): boolean {
  return MINIFIED_NAME_PATTERNS.some((p) => p.test(filePath));
}

/** True when the content check applies to `filePath` (JS or CSS). */
export function checksMinifiedContent(filePath: string): boolean {
  return MINIFIED_CONTENT_EXTENSIONS.has(extname(filePath).toLowerCase());
}

/** True when `head` holds a line longer than {@link MINIFIED_LINE_CHARS} within its first {@link MINIFIED_HEAD_BYTES}. */
export function hasMinifiedLine(head: Buffer | string): boolean {
  const text = typeof head === "string"
    ? head.slice(0, MINIFIED_HEAD_BYTES)
    : head.subarray(0, MINIFIED_HEAD_BYTES).toString("latin1");
  let start = 0;
  while (start < text.length) {
    const end = text.indexOf("\n", start);
    const lineEnd = end === -1 ? text.length : end;
    if (lineEnd - start > MINIFIED_LINE_CHARS) return true;
    if (end === -1) return false;
    start = end + 1;
  }
  return false;
}

/** True when `filePath` is minified: by name, or, for JS/CSS, by a long line in `head`. */
export function isMinifiedFile(filePath: string, head?: Buffer | string): boolean {
  if (isMinifiedName(filePath)) return true;
  return head !== undefined && checksMinifiedContent(filePath) && hasMinifiedLine(head);
}
