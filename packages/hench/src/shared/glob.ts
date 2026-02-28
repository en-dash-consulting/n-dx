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
