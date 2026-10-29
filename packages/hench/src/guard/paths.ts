/**
 * Path validation — defense-in-depth filesystem access control.
 *
 * Every file path the agent touches is validated through four checks:
 *
 * 1. **Null-byte rejection** — prevents poison-null-byte attacks where
 *    embedded `\0` characters cause `path.resolve()` to silently
 *    truncate, potentially bypassing later checks.
 *
 * 2. **Directory escape prevention** — resolved paths must remain within
 *    the project directory. Relative paths with `..` that escape the
 *    project root are rejected.
 *
 * 3. **Real-path containment** — the target is resolved through symbolic
 *    links (the nearest existing ancestor stands in for a path that does not
 *    exist yet) and that real location must also lie inside the real project
 *    directory. A link inside the project that points elsewhere is refused.
 *    Callers receive the real path, so the I/O they then perform happens at
 *    the location that was checked.
 *
 * 4. **Glob-based blocked patterns** — configurable patterns (e.g.,
 *    `.git/**`, `.hench/**`, `node_modules/**`) block access to
 *    sensitive directories. Matched against the path as given and against
 *    its real location, so a link into a blocked directory is blocked too.
 *    Uses {@link simpleGlobMatch} instead of external dependencies.
 *
 * @module
 */

import { resolve, relative, dirname, basename, join, isAbsolute, sep } from "node:path";
import { realpathSync } from "node:fs";
import { ClaudeClientError } from "../prd/llm-gateway.js";

/**
 * Security guard error — thrown when path validation detects a violation.
 *
 * Extends {@link ClaudeClientError} to integrate with the unified error
 * hierarchy. Uses reason "cli" (agent operation error) and is never
 * retryable (security violations are deterministic).
 */
export class GuardError extends ClaudeClientError {
  constructor(message: string) {
    super(message, "cli", false);
    this.name = "GuardError";
  }
}

/**
 * Simple glob matching — supports *, **, and ? patterns.
 * No external dependency needed.
 *
 * - `*`  matches anything except `/` (single path segment)
 * - `**` matches any number of path segments (including zero)
 * - `?`  matches exactly one character except `/`
 *
 * A trailing `/**` also matches the directory itself (e.g. `.git/**` matches `.git`).
 */
export function simpleGlobMatch(pattern: string, filepath: string): boolean {
  // Normalize separators
  const p = pattern.replace(/\\/g, "/");
  const f = filepath.replace(/\\/g, "/");

  const regexParts: string[] = [];
  let i = 0;

  while (i < p.length) {
    if (p[i] === "*" && p[i + 1] === "*") {
      // ** matches any number of path segments
      if (p[i + 2] === "/") {
        regexParts.push("(?:.+/)?");
        i += 3;
      } else {
        // Terminal ** — also match the parent directory itself.
        // "dir/**" should match "dir", "dir/foo", "dir/foo/bar"
        // Look back: if preceded by "/", make the "/" and everything after optional
        if (i >= 1 && p[i - 1] === "/") {
          // Replace the trailing "/" already emitted with an optional group
          const lastPart = regexParts.pop()!;
          regexParts.push("(?:" + lastPart + ".*)?");
        } else {
          regexParts.push(".*");
        }
        i += 2;
      }
    } else if (p[i] === "*") {
      // * matches anything except /
      regexParts.push("[^/]*");
      i++;
    } else if (p[i] === "?") {
      regexParts.push("[^/]");
      i++;
    } else {
      // Escape regex special chars
      regexParts.push(p[i].replace(/[.+^${}()|[\]\\]/g, "\\$&"));
      i++;
    }
  }

  const regex = new RegExp("^" + regexParts.join("") + "$");
  return regex.test(f);
}

/** Whether a `path.relative()` result points outside the base directory. */
function escapes(rel: string): boolean {
  return rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith("../") || isAbsolute(rel);
}

/**
 * The real path of `target`, with every symbolic link resolved.
 *
 * When `target` (or a trailing part of it) does not exist yet, the nearest
 * existing ancestor is resolved and the missing segments are appended again,
 * so a file about to be created is checked at the location it will land in.
 * Only "does not exist" errors walk up; anything else (a link loop, a
 * permission refusal) propagates, because the real location could not be
 * established.
 */
export function resolveRealPath(target: string): string {
  const missing: string[] = [];
  let current = target;
  for (;;) {
    try {
      const real = realpathSync.native(current);
      return missing.length ? join(real, ...missing) : real;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw err;
      const parent = dirname(current);
      if (parent === current) return target;
      missing.unshift(basename(current));
      current = parent;
    }
  }
}

/**
 * Validate a path the agent wants to touch and return its real location.
 *
 * `projectDir` may be given in either spelling — as configured, or as its
 * real path (they differ when the project sits behind a link, e.g. `/var`
 * on macOS) — and so may an absolute `filepath`.
 *
 * @throws {GuardError} when the path leaves the project, lexically or once
 *   links are resolved, or matches a blocked pattern in either form.
 */
export function validatePath(
  filepath: string,
  projectDir: string,
  blockedPaths: string[],
): string {
  // Reject null bytes — defense-in-depth against poison-null-byte attacks.
  // Node's path.resolve strips them silently, which can confuse later checks.
  if (filepath.includes("\0")) {
    throw new GuardError(
      `Path contains null byte: ${filepath.replace(/\0/g, "\\0")}`,
    );
  }

  const root = resolve(projectDir);
  const resolved = resolve(root, filepath);

  let realRoot: string;
  let real: string;
  try {
    realRoot = resolveRealPath(root);
    real = resolveRealPath(resolved);
  } catch (err) {
    throw new GuardError(
      `Cannot resolve real path of ${filepath}: ${(err as Error).message}`,
    );
  }

  // Lexical containment, in whichever spelling of the project directory the
  // caller used.
  let rel = relative(root, resolved);
  if (escapes(rel)) {
    rel = relative(realRoot, resolved);
    if (escapes(rel)) {
      throw new GuardError(
        `Path escapes project directory: ${filepath}`,
      );
    }
  }

  // Containment of the real location, which is where the I/O will happen.
  const realRel = relative(realRoot, real);
  if (escapes(realRel)) {
    throw new GuardError(
      `Path resolves outside project directory: ${filepath}`,
    );
  }

  // Check blocked path patterns against both forms.
  // Check blocked path patterns, ignoring case: on macOS and Windows
  // `.N-DX.local.json` and `.ENV` open the files the blocks name, so a
  // case-sensitive match let any blocked file be written under another
  // spelling. Stricter on a case-sensitive filesystem, never looser.
  const relLower = rel.toLowerCase();
  for (const pattern of blockedPaths) {
    if (simpleGlobMatch(pattern.toLowerCase(), relLower)) {
      throw new GuardError(
        `Path matches blocked pattern "${pattern}": ${filepath}`,
      );
    }
    if (realRel !== rel && simpleGlobMatch(pattern.toLowerCase(), realRel.toLowerCase())) {
      throw new GuardError(
        `Path matches blocked pattern "${pattern}" (resolves to ${realRel}): ${filepath}`,
      );
    }
  }

  return real;
}
