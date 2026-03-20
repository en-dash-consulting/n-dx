import { join, basename } from "node:path";
import { writeFile, access } from "node:fs/promises";
import { SCHEMA_VERSION, DEFAULT_CONFIG } from "../../schema/index.js";
import { toCanonicalJSON } from "../../core/canonical.js";
import { ensureRexDir } from "../../store/index.js";
import { DEFAULT_WORKFLOW } from "../../workflow/default.js";
import { REX_DIR, REX_FILES } from "./constants.js";
import { info } from "../output.js";
import type { PRDDocument } from "../../schema/index.js";

export async function cmdInit(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const rexDir = join(dir, REX_DIR);

  await ensureRexDir(rexDir);

  const project = flags.project ?? basename(dir);

  // config.json
  const configPath = join(rexDir, REX_FILES.CONFIG);
  try {
    await access(configPath);
    info(`${REX_FILES.CONFIG} already exists, skipping`);
  } catch {
    const config = DEFAULT_CONFIG(project);
    await writeFile(configPath, toCanonicalJSON(config), "utf-8");
    info(`Created ${REX_FILES.CONFIG}`);
  }

  // prd.json
  const prdPath = join(rexDir, REX_FILES.PRD);
  try {
    await access(prdPath);
    info(`${REX_FILES.PRD} already exists, skipping`);
  } catch {
    const doc: PRDDocument = {
      schema: SCHEMA_VERSION,
      title: project,
      items: [],
    };
    await writeFile(prdPath, toCanonicalJSON(doc), "utf-8");
    info(`Created ${REX_FILES.PRD}`);
  }

  // execution-log.jsonl
  const logPath = join(rexDir, REX_FILES.EXECUTION_LOG);
  try {
    await access(logPath);
    info(`${REX_FILES.EXECUTION_LOG} already exists, skipping`);
  } catch {
    await writeFile(logPath, "", "utf-8");
    info(`Created ${REX_FILES.EXECUTION_LOG}`);
  }

  // workflow.md
  const workflowPath = join(rexDir, REX_FILES.WORKFLOW);
  try {
    await access(workflowPath);
    info(`${REX_FILES.WORKFLOW} already exists, skipping`);
  } catch {
    await writeFile(workflowPath, DEFAULT_WORKFLOW, "utf-8");
    info(`Created ${REX_FILES.WORKFLOW}`);
  }

  info(`\nInitialized .n-dx/rex/ in ${dir}`);
  info("Next steps:");
  info("  rex add epic --title=\"Your first epic\" " + dir);
  info("  rex status " + dir);
}
