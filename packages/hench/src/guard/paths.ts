import { resolve, relative } from "node:path";

export class GuardError extends Error {
  constructor(message: string) {
    super(message);
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

  const resolved = resolve(projectDir, filepath);
  const rel = relative(projectDir, resolved);

  // Reject paths that escape the project directory
  if (rel.startsWith("..")) {
    throw new GuardError(
      `Path escapes project directory: ${filepath}`,
    );
  }

  // Check blocked path patterns
  for (const pattern of blockedPaths) {
    if (simpleGlobMatch(pattern, rel)) {
      throw new GuardError(
        `Path matches blocked pattern "${pattern}": ${filepath}`,
      );
    }
  }

  return resolved;
}
