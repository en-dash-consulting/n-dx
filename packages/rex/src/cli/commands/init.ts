import { join, basename } from "node:path";
import { readFile, writeFile, access } from "node:fs/promises";
import { SCHEMA_VERSION, DEFAULT_CONFIG } from "../../schema/index.js";
import { toCanonicalJSON } from "../../core/canonical.js";
import { ensureRexDir } from "../../store/index.js";
import { NDX_WORKFLOW, USER_WORKFLOW_TEMPLATE } from "../../workflow/default.js";
import { REX_DIR } from "./constants.js";
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
  const configPath = join(rexDir, "config.json");
  try {
    await access(configPath);
    info("config.json already exists, skipping");
  } catch {
    const config = DEFAULT_CONFIG(project);
    await writeFile(configPath, toCanonicalJSON(config), "utf-8");
    info("Created config.json");
  }

  // prd.json
  const prdPath = join(rexDir, "prd.json");
  try {
    await access(prdPath);
    info("prd.json already exists, skipping");
  } catch {
    const doc: PRDDocument = {
      schema: SCHEMA_VERSION,
      title: project,
      items: [],
    };
    await writeFile(prdPath, toCanonicalJSON(doc), "utf-8");
    info("Created prd.json");
  }

  // execution-log.jsonl
  const logPath = join(rexDir, "execution-log.jsonl");
  try {
    await access(logPath);
    info("execution-log.jsonl already exists, skipping");
  } catch {
    await writeFile(logPath, "", "utf-8");
    info("Created execution-log.jsonl");
  }

  // n-dx_workflow.md (base workflow — always overwritten to stay current)
  const ndxWorkflowPath = join(rexDir, "n-dx_workflow.md");
  await writeFile(ndxWorkflowPath, NDX_WORKFLOW, "utf-8");
  info("Updated n-dx_workflow.md");

  // workflow.md (user customizations — only created if missing)
  const workflowPath = join(rexDir, "workflow.md");
  try {
    await access(workflowPath);
    info("workflow.md already exists, skipping");
  } catch {
    await writeFile(workflowPath, USER_WORKFLOW_TEMPLATE, "utf-8");
    info("Created workflow.md (edit to add project-specific rules)");
  }

  // Ensure .gitignore covers generated rex files
  await ensureGitignoreEntries(dir, [
    ".rex/n-dx_workflow.md",
    ".rex/execution-log*.jsonl",
  ]);

  info(`\nInitialized .rex/ in ${dir}`);
  info("Next steps:");
  info("  rex add epic --title=\"Your first epic\" " + dir);
  info("  rex status " + dir);
}

/**
 * Append entries to .gitignore if not already present.
 * Creates .gitignore if it doesn't exist.
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
