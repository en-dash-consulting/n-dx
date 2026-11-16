import { join } from "node:path";
import { access, readFile, readdir, stat, writeFile } from "node:fs/promises";
import {configExists, initConfig} from "../../store/config.js";
import { henchRuntimeGitignoreEntries } from "../../store/artifacts.js";
import { resolveHenchPaths } from "../../store/paths.js";
import { relativeToRoot, resolveLayout } from "../../prd/llm-gateway.js";
import { info } from "../output.js";
import type { ProjectLanguage } from "../../schema/index.js";

/** True when any top-level directory ends in .xcodeproj or .xcworkspace. */
async function hasXcodeProjectMarker(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.some(
      (e) => e.isDirectory() && (e.name.endsWith(".xcodeproj") || e.name.endsWith(".xcworkspace")),
    );
  } catch {
    return false;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

/** True when `path` is a regular file (not a directory of that name). */
async function isRegularFile(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

/**
 * Append entries to .gitignore if not already present. Creates .gitignore
 * if it doesn't exist. Mirrors rex's own `ensureGitignoreEntries` (rex's
 * cli/commands/init.ts) — duplicated rather than shared across packages,
 * matching this codebase's existing convention for tiny package-local init
 * helpers (see detectProjectLanguage's own "mirrors sourcevision's logic
 * without importing it" comment above).
 */
async function ensureGitignoreEntries(dir: string, entries: readonly string[]): Promise<void> {
  const gitignorePath = join(dir, ".gitignore");
  let content = "";
  try {
    content = await readFile(gitignorePath, "utf-8");
  } catch {
    // No .gitignore yet
  }

  const missing = entries.filter((e) => !content.includes(e));
  if (missing.length === 0) return;

  const suffix = (content.length > 0 && !content.endsWith("\n") ? "\n" : "")
    + missing.join("\n") + "\n";
  await writeFile(gitignorePath, content + suffix, "utf-8");
}

/**
 * Detect the project language for guard configuration.
 *
 * Detection chain (mirrors sourcevision's logic without importing it):
 * 1. Explicit project-config `language` override
 * 2. `go.mod` present → "go"
 * 3. `Package.swift` OR `*.xcodeproj` / `*.xcworkspace` directory → "swift"
 * 4. `composer.json` → "php", unless a root `package.json` sits beside it and
 *    {@link phpOutnumbersJsTs} says the source is not mostly PHP
 * 5. Otherwise → undefined (JS/TS defaults)
 *
 * Steps 2–4 match `detectRepoLanguage` in `@n-dx/llm-client`, which picks the
 * guard baseline repository trust compares this config against.
 */
export async function detectProjectLanguage(dir: string): Promise<ProjectLanguage | undefined> {
  // Step 1: Check the project config for an explicit language override
  try {
    const raw = await readFile(resolveLayout(dir).configFile, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    if (typeof config.language === "string" && config.language !== "auto") {
      const lang = config.language;
      if (lang === "go" || lang === "swift" || lang === "php" || lang === "typescript" || lang === "javascript") {
        return lang;
      }
    }
  } catch {
    // No .n-dx.json or invalid — continue detection
  }

  // Step 2: Check for go.mod marker
  if (await fileExists(join(dir, "go.mod"))) return "go";

  // Step 3: Check for Swift markers — Package.swift OR an Xcode project.
  if (await fileExists(join(dir, "Package.swift"))) return "swift";
  if (await hasXcodeProjectMarker(dir)) return "swift";

  // Step 4: Composer manifest. A file, as detectRepoLanguage requires. Beside a
  // package.json the source count breaks the tie.
  if (await isRegularFile(join(dir, "composer.json"))) {
    if (!(await isRegularFile(join(dir, "package.json")))) return "php";
    if (await phpOutnumbersJsTs(dir)) return "php";
  }

  return undefined;
}

const PHP_SOURCE = /\.(php|phtml|inc)$/;
const JS_TS_SOURCE = /\.(js|jsx|mjs|cjs|ts|tsx|mts|cts)$/;

/** Dependency and build directories the count skips, as lang-kit's `COUNT_SKIP_DIRS`. */
const COUNT_SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules", "vendor", "venv", "site-packages", "bin", "obj", "dist", "build",
]);

/** Depth and directory bounds of lang-kit's count, plus a cap on entries read. */
const COUNT_MAX_DEPTH = 3;
const COUNT_MAX_DIRS = 2000;
const COUNT_MAX_ENTRIES = 20000;

/**
 * Does PHP source outnumber JS/TS source? The tiebreak for a root holding both
 * `composer.json` and `package.json`; a tie is JS/TS. Mirrors lang-kit's
 * `detectLanguage` rule 3 (packages/lang-kit/src/detect.ts): a breadth-first
 * walk to three levels below the root, skipping dot-directories and
 * dependency/build directories, stopping after {@link COUNT_MAX_DIRS}
 * directories or {@link COUNT_MAX_ENTRIES} entries and deciding on what it
 * counted. Minified `.min.js` is library code and is not counted, as in
 * lang-kit; unlike lang-kit, `.inc` counts as PHP, because this choice only
 * exists once a root `composer.json` says the repository is PHP. Must give the same answer as `phpOutnumbersJsTs` in
 * `@n-dx/llm-client`'s repo-trust.ts, or repository trust flags the guard
 * init wrote.
 */
async function phpOutnumbersJsTs(rootDir: string): Promise<boolean> {
  let php = 0;
  let jsTs = 0;
  let dirs = 0;
  let seen = 0;
  let queue = [rootDir];
  for (let depth = 0; depth <= COUNT_MAX_DEPTH && queue.length > 0; depth++) {
    const next: string[] = [];
    for (const dir of queue) {
      if (dirs++ >= COUNT_MAX_DIRS) return php > jsTs;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue; // Unreadable directory: count what the rest holds.
      }
      for (const entry of entries) {
        if (seen++ >= COUNT_MAX_ENTRIES) return php > jsTs;
        if (entry.isDirectory()) {
          if (!entry.name.startsWith(".") && !COUNT_SKIP_DIRS.has(entry.name)) next.push(join(dir, entry.name));
        } else if (entry.isFile()) {
          if (PHP_SOURCE.test(entry.name)) php++;
          else if (JS_TS_SOURCE.test(entry.name) && !entry.name.endsWith(".min.js")) jsTs++;
        }
      }
    }
    queue = next;
  }
  return php > jsTs;
}

export async function cmdInit(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const layout = resolveLayout(dir);
  const { henchDir } = resolveHenchPaths(dir);
  // What to call the directory in output and in `.gitignore` — `.hench` or
  // `.ndx/hench`, whichever this project is on.
  const henchDirName = relativeToRoot(layout, henchDir);

  // Ensure .gitignore covers hench's own runtime artifacts. The locks
  // directory is created the instant a run starts, before any real work
  // happens, so without these entries it shows up as an untracked path on the
  // very first `hench run`/`ndx work` — see store/artifacts.ts for the full
  // story.
  //
  // Deliberately ahead of the already-initialized early return: a project
  // initialized before these entries existed would otherwise never receive
  // them, since init is a no-op on every subsequent invocation. The write is
  // itself a no-op when the entries are already present, so re-running init
  // still leaves .gitignore byte-identical.
  await ensureGitignoreEntries(dir, henchRuntimeGitignoreEntries(henchDirName));

  if (await configExists(henchDir)) {
    info(`${henchDirName}/ already initialized, skipping`);
    return;
  }

  const language = await detectProjectLanguage(dir);
  const config = await initConfig(henchDir, language, relativeToRoot(layout, layout.rexDir));

  info(`Created ${henchDirName}/config.json`);
  info(`Created ${henchDirName}/runs/`);
  if (language) {
    info(`Detected language: ${language}`);
  }
  info(`\nInitialized ${henchDirName}/ in ${dir}`);
  info(`Model: ${config.model}`);
  info(`Max turns: ${config.maxTurns}`);
  info(`Rex dir: ${config.rexDir}`);
  info("\nNext steps:");
  info("  hench run " + dir);
  info("  hench status " + dir);
}
