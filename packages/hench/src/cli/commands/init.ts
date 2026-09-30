import { join } from "node:path";
import { access, readFile, readdir, writeFile } from "node:fs/promises";
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
 * 4. Otherwise → undefined (JS/TS defaults)
 */
async function detectProjectLanguage(dir: string): Promise<ProjectLanguage | undefined> {
  // Step 1: Check the project config for an explicit language override
  try {
    const raw = await readFile(resolveLayout(dir).configFile, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    if (typeof config.language === "string" && config.language !== "auto") {
      const lang = config.language;
      if (lang === "go" || lang === "swift" || lang === "typescript" || lang === "javascript") {
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

  return undefined;
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
