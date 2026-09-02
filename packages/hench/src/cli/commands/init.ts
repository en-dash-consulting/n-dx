import { join } from "node:path";
import { access, readFile, readdir, writeFile } from "node:fs/promises";
import {configExists, initConfig} from "../../store/config.js";
import { HENCH_DIR } from "./constants.js";
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
async function ensureGitignoreEntries(dir: string, entries: string[]): Promise<void> {
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
 * 1. Explicit `.n-dx.json` `language` override
 * 2. `go.mod` present → "go"
 * 3. `Package.swift` OR `*.xcodeproj` / `*.xcworkspace` directory → "swift"
 * 4. Otherwise → undefined (JS/TS defaults)
 */
async function detectProjectLanguage(dir: string): Promise<ProjectLanguage | undefined> {
  // Step 1: Check .n-dx.json for explicit language override
  try {
    const raw = await readFile(join(dir, ".n-dx.json"), "utf-8");
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
  const henchDir = join(dir, HENCH_DIR);

  if (await configExists(henchDir)) {
    info(".hench/ already initialized, skipping");
    return;
  }

  const language = await detectProjectLanguage(dir);
  const config = await initConfig(henchDir, language);

  // Ensure .gitignore covers hench's own runtime artifacts. Without this,
  // `.hench/locks/` (created the instant a run starts, before any real
  // work happens) shows up as an untracked path on the very first
  // `hench run`/`ndx work` on a freshly-initialized project — and hench's
  // own git-dirty guard (agent/lifecycle/shared.ts) then refuses to start,
  // self-blocking on an artifact it just created. `.hench/runs/` and
  // `.hench/usage-cursors/` are the same kind of per-run/per-session output;
  // `.hench-commit-msg.txt` is the scratch file the agent writes its
  // proposed commit message to (see the agent system prompt).
  await ensureGitignoreEntries(dir, [
    ".hench/runs/",
    ".hench/locks/",
    ".hench/usage-cursors/",
    ".hench-commit-msg.txt",
  ]);

  info("Created .hench/config.json");
  info("Created .hench/runs/");
  if (language) {
    info(`Detected language: ${language}`);
  }
  info(`\nInitialized .hench/ in ${dir}`);
  info(`Model: ${config.model}`);
  info(`Max turns: ${config.maxTurns}`);
  info(`Rex dir: ${config.rexDir}`);
  info("\nNext steps:");
  info("  hench run " + dir);
  info("  hench status " + dir);
}
