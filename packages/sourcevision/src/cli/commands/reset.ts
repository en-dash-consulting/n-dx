import { existsSync, mkdirSync, rmSync, readdirSync, copyFileSync, statSync, writeFileSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { info } from "../output.js";
import { detectSubAnalyses } from "../sourcevision-core.js";
import { resolveSourcevisionPaths } from "../../paths.js";

/** Reset a single .sourcevision/ directory: backup files then clear. */
function resetSvDir(svDir: string, label: string): void {
  const backupDir = join(svDir, ".backup");
  if (existsSync(backupDir)) {
    rmSync(backupDir, { recursive: true, force: true });
  }
  mkdirSync(backupDir, { recursive: true });

  const entries = readdirSync(svDir);
  for (const entry of entries) {
    if (entry === ".backup" || entry === ".gitignore") continue;
    const src = join(svDir, entry);
    if (statSync(src).isFile()) {
      copyFileSync(src, join(backupDir, entry));
    }
  }

  // Ensure .backup is gitignored
  writeFileSync(join(svDir, ".gitignore"), ".backup/\n");

  // Remove all analysis files (keep .backup and .gitignore)
  for (const entry of entries) {
    if (entry === ".backup" || entry === ".gitignore") continue;
    rmSync(join(svDir, entry), { recursive: true, force: true });
  }

  info(`Cleared ${label}`);
}

export function cmdReset(dir: string): void {
  const absDir = resolve(dir);
  const svDir = resolveSourcevisionPaths(absDir).svDir;

  if (!existsSync(svDir)) {
    info(`No .sourcevision/ directory found in ${absDir} — nothing to reset.`);
    return;
  }

  // Detect sub-analyses before clearing root (detection reads manifests)
  const subs = detectSubAnalyses(absDir);

  // Reset root
  resetSvDir(svDir, svDir);

  // Reset sub-analyses
  for (const sub of subs) {
    const subSvDir = resolveSourcevisionPaths(join(absDir, sub.prefix)).svDir;
    if (existsSync(subSvDir)) {
      resetSvDir(subSvDir, relative(absDir, subSvDir));
    }
  }

  const total = 1 + subs.length;
  info(`Reset ${total} .sourcevision/ director${total === 1 ? "y" : "ies"}.`);
  info("Run 'sourcevision analyze' to start fresh.");
}
