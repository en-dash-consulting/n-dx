import { writeFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { getCurrentHead, getCurrentBranch, relativeToRoot, resolveLayout } from "@n-dx/llm-client";
import { SCHEMA_VERSION } from "../sourcevision-core.js";
import { TOOL_VERSION } from "./constants.js";
import { info } from "../output.js";
import { resolveSourcevisionPaths } from "../../paths.js";

export const HINTS_TEMPLATE = `<!-- Sourcevision Hints -->
<!-- Uncomment and edit the lines below to provide project context -->
<!-- that improves AI-generated zone names, descriptions, and insights. -->
<!--                                                                    -->
<!-- Example:                                                           -->
<!-- This is a Next.js app-router project following domain-driven       -->
<!-- design. Zones should map to business domains (auth, billing,       -->
<!-- catalog) rather than technical layers. The legacy/ directory is     -->
<!-- being migrated and should be flagged as technical debt.             -->
`;

export function cmdInit(dir: string): void {
  const absDir = resolve(dir);
  const layout = resolveLayout(absDir);
  const svDir = resolveSourcevisionPaths(absDir).svDir;
  // What to call the directory in output — `.sourcevision` or
  // `.ndx/sourcevision`, whichever this project is on.
  const svDirName = relativeToRoot(layout, svDir);

  // `.cache/` is machine-local (see docs/architecture/generated-files.md).
  // Ignore it before the already-initialized return so a re-init fixes a
  // project initialized without the entry: `ndx init` commits what init
  // wrote, and would otherwise commit the cache with it.
  ensureGitignoreEntry(absDir, `${svDirName}/.cache/`);

  if (existsSync(join(svDir, "manifest.json"))) {
    info(`${svDirName}/ already initialized in ${absDir}`);
    info("Run 'sourcevision analyze' to update.");
    return;
  }

  mkdirSync(svDir, { recursive: true });

  // Git info (returns undefined if not a git repo)
  const gitSha = getCurrentHead(absDir);
  const gitBranch = getCurrentBranch(absDir);

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    toolVersion: TOOL_VERSION,
    analyzedAt: new Date().toISOString(),
    ...(gitSha ? { gitSha } : {}),
    ...(gitBranch ? { gitBranch } : {}),
    targetPath: absDir,
    modules: {},
  };

  writeFileSync(join(svDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  // Create hints.md template (only if not already present)
  const hintsPath = join(svDir, "hints.md");
  if (!existsSync(hintsPath)) {
    writeFileSync(hintsPath, HINTS_TEMPLATE);
  }

  info(`Initialized ${svDirName}/ in ${absDir}`);
  info(`  ${join(svDir, "manifest.json")} created`);
  info(`  ${join(svDir, "hints.md")} created`);
  info("");
  info(`Analysis output saved to ${svDirName}/ — this is designed to be committed to your repo.`);
  info("The viewer UI is served from the sourcevision package and is not stored in your project.");
  info("");

  info("Next steps:");
  info("  sourcevision analyze    Run the analysis pipeline");
  info("  sourcevision serve      View results in the browser");
}

/** Append `entry` to the project's `.gitignore` unless a line already names it. */
function ensureGitignoreEntry(dir: string, entry: string): void {
  const gitignorePath = join(dir, ".gitignore");
  let content = "";
  try {
    content = readFileSync(gitignorePath, "utf-8");
  } catch {
    // No .gitignore yet
  }
  if (content.split(/\r?\n/).some((line) => line.trim() === entry)) return;
  const sep = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  writeFileSync(gitignorePath, content + sep + entry + "\n", "utf-8");
}
