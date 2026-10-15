/**
 * The project file walk: which directories are skipped, the `.gitignore` /
 * `.sourcevisionignore` filter, and the traversal itself.
 *
 * The inventory (`analyzers/inventory.ts`) and Terraform detection
 * (`language/detect.ts`) both walk through here, so a file one of them sees
 * is a file the other sees.
 *
 * @module sourcevision/util/project-walk
 */

import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { PROJECT_DIRS } from "@n-dx/llm-client";
import { skipsDirectory, type LanguageConfig } from "@n-dx/lang-kit";
import { toPosix } from "./paths.js";

// ── Skip patterns ────────────────────────────────────────────────────────────

/** Always-skipped directories regardless of language config. */
const BASE_SKIP_DIRS: ReadonlySet<string> = new Set([
  ".git",
  // n-dx tooling state, not user source — exclude from the inventory entirely
  // so generated PRD markdown / logs don't skew the Overview language stats.
  PROJECT_DIRS.SOURCEVISION,
  PROJECT_DIRS.REX,
  PROJECT_DIRS.HENCH,
]);

/**
 * Vendored third-party dependency directories, excluded from the inventory in
 * every project regardless of detected language. These hold code the project
 * did not author (like `node_modules`), so scanning them inflates language
 * stats and pollutes source-logic analysis. Per-language configs still add
 * their own vendored dirs (e.g. Go's `vendor/`, Python's virtualenvs); this
 * universal set covers cross-language conventions and the JS ecosystem's own
 * vendored dirs, which a non-Go/Python project would otherwise never skip.
 * Matched by exact directory name at any depth, so a plural `vendors/` dir or
 * a `vendor-utils.ts` source file is unaffected.
 *
 * `.terraform` holds Terraform's downloaded providers and modules. It is here
 * rather than only in the Terraform config so that a repository whose sole
 * `.tf` files are downloaded modules is neither detected as Terraform nor
 * inventoried with them.
 */
const VENDOR_SKIP_DIRS: ReadonlySet<string> = new Set([
  "vendor",
  "vendored",
  "third_party",
  "third-party",
  "thirdparty",
  "bower_components",
  "jspm_packages",
  "web_modules",
  "Godeps",
  ".yarn",
  ".terraform",
]);

/** The directories a walk skips, in the language config's terms. */
export type ProjectSkip = Pick<LanguageConfig, "skipDirectories" | "skipUnlessContains">;

/**
 * What the walk skips: the base and vendored sets, the language config's own
 * `skipDirectories` and `skipUnlessContains`, and the user's `extraSkipDirs`.
 */
export function projectSkip(
  language: ProjectSkip,
  extraSkipDirs: Iterable<string> = [],
): ProjectSkip {
  return {
    skipDirectories: new Set([...BASE_SKIP_DIRS, ...VENDOR_SKIP_DIRS, ...language.skipDirectories, ...extraSkipDirs]),
    ...(language.skipUnlessContains ? { skipUnlessContains: language.skipUnlessContains } : {}),
  };
}

// ── Ignore filter ────────────────────────────────────────────────────────────

interface IgnoreRule {
  regex: RegExp;
  negated: boolean;
  dirOnly: boolean;
}

function compilePattern(pattern: string): IgnoreRule {
  let negated = false;
  let dirOnly = false;

  // Leading ! means negation
  if (pattern.startsWith("!")) {
    negated = true;
    pattern = pattern.slice(1);
  }

  // Trailing / means directory-only
  if (pattern.endsWith("/")) {
    dirOnly = true;
    pattern = pattern.slice(0, -1);
  }

  // Leading / means anchored to root; otherwise matches at any depth
  const anchored = pattern.startsWith("/");
  if (anchored) {
    pattern = pattern.slice(1);
  }

  // Convert gitignore glob to regex
  let regex = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          // **/ matches zero or more directories
          regex += "(?:.*/)?";
          i += 3;
          continue;
        }
        // ** at end or mid-pattern matches everything
        regex += ".*";
        i += 2;
        continue;
      }
      regex += "[^/]*";
      i++;
    } else if (ch === "?") {
      regex += "[^/]";
      i++;
    } else if (ch === "[") {
      // Pass through character classes
      const close = pattern.indexOf("]", i + 1);
      if (close === -1) {
        regex += "\\[";
        i++;
      } else {
        regex += pattern.slice(i, close + 1);
        i = close + 1;
      }
    } else if (".+^${}()|\\".includes(ch)) {
      regex += "\\" + ch;
      i++;
    } else {
      regex += ch;
      i++;
    }
  }

  // If pattern contains a slash, it's always anchored
  const hasSlash = pattern.includes("/");
  if (anchored || hasSlash) {
    regex = "^" + regex;
  } else {
    // Matches at any depth: can appear after a /
    regex = "(?:^|/)" + regex;
  }

  regex += "$";

  return { regex: new RegExp(regex), negated, dirOnly };
}

export class IgnoreFilter {
  private rules: IgnoreRule[] = [];

  add(content: string): void {
    for (const raw of content.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      this.rules.push(compilePattern(line));
    }
  }

  ignores(path: string): boolean {
    const isDir = path.endsWith("/");
    const testPath = isDir ? path.slice(0, -1) : path;

    let ignored = false;
    for (const rule of this.rules) {
      if (rule.dirOnly && !isDir) continue;
      if (rule.regex.test(testPath)) {
        ignored = !rule.negated;
      }
    }
    return ignored;
  }
}

export async function loadIgnoreFilter(rootDir: string): Promise<IgnoreFilter> {
  const filter = new IgnoreFilter();

  for (const name of [".gitignore", ".sourcevisionignore"]) {
    try {
      const content = await readFile(join(rootDir, name), "utf-8");
      filter.add(content);
    } catch {
      // File doesn't exist — skip
    }
  }

  return filter;
}

// ── Traversal ────────────────────────────────────────────────────────────────

/**
 * Yield every file under `dir` as a POSIX path relative to `rootDir`, depth
 * first in `readdir` order. Skips the directories `skip` names (see
 * `skipsDirectory`), paths the ignore filter rejects, and `.gitkeep`. A file
 * named like a skipped directory is skipped too. Symlinks are not followed. A
 * consumer that stops early (`break` / `return`) stops the walk.
 */
export async function* walkProjectFiles(
  dir: string,
  rootDir: string,
  ig: IgnoreFilter,
  skip: ProjectSkip,
): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === ".gitkeep") continue;

    const fullPath = join(dir, entry.name);
    const relPath = toPosix(relative(rootDir, fullPath));

    if (entry.isDirectory()) {
      if (skipsDirectory(skip, entry.name, (file) => existsSync(join(fullPath, file)))) continue;
      if (ig.ignores(relPath + "/")) continue;
      yield* walkProjectFiles(fullPath, rootDir, ig, skip);
    } else if (entry.isFile()) {
      if (skip.skipDirectories.has(entry.name) || skip.skipUnlessContains?.has(entry.name)) continue;
      if (ig.ignores(relPath)) continue;
      yield relPath;
    }
  }
}
