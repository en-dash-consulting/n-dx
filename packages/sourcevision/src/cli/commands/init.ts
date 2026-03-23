import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { getCurrentHead, getCurrentBranch } from "@n-dx/llm-client";
import { SCHEMA_VERSION } from "../../schema/v1.js";
import { TOOL_VERSION, SV_DIR, SV_FILES } from "./constants.js";
import { info } from "../output.js";

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
  const svDir = join(absDir, SV_DIR);

  if (existsSync(join(svDir, SV_FILES.MANIFEST))) {
    info(`.n-dx/sourcevision/ already initialized in ${absDir}`);
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

  writeFileSync(join(svDir, SV_FILES.MANIFEST), JSON.stringify(manifest, null, 2) + "\n");

  // Create hints.md template (only if not already present)
  const hintsPath = join(svDir, SV_FILES.HINTS);
  if (!existsSync(hintsPath)) {
    writeFileSync(hintsPath, HINTS_TEMPLATE);
  }

  info(`Initialized .n-dx/sourcevision/ in ${absDir}`);
  info(`  ${join(svDir, SV_FILES.MANIFEST)} created`);
  info(`  ${join(svDir, SV_FILES.HINTS)} created`);
  info("");
  info("Analysis output saved to .n-dx/sourcevision/ — this is designed to be committed to your repo.");
  info("");

  info("Next steps:");
  info("  sourcevision analyze    Run the analysis pipeline");
  info("  sourcevision serve      View results in the browser");
}
