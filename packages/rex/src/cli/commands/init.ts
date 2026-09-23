import { join, basename } from "node:path";
import { readFile, writeFile, access, mkdir } from "node:fs/promises";
import { DEFAULT_CONFIG } from "../../schema/index.js";
import { toCanonicalJSON } from "../../core/canonical.js";
import { ensureRexDir } from "../../store/index.js";
import { NDX_WORKFLOW, USER_WORKFLOW_TEMPLATE } from "../../workflow/default.js";
import { REX_DIR } from "./constants.js";
import { FOLDER_TREE_SUBDIR } from "./folder-tree-sync.js";
import { info } from "../output.js";

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

  // .rex/prd_tree/ — folder-tree scaffold (created once; not overwritten)
  const treeDir = join(rexDir, FOLDER_TREE_SUBDIR);
  await mkdir(treeDir, { recursive: true });
  const treeRootStub = join(treeDir, "index.md");
  try {
    await access(treeRootStub);
    info(`tree/index.md already exists, skipping`);
  } catch {
    await writeFile(
      treeRootStub,
      `# ${project}\n\nPRD folder tree for **${project}**.\nManaged by rex — add items with \`rex add epic\`.\n`,
      "utf-8",
    );
    info("Created tree/index.md");
  }

  // NOTE: init deliberately does *not* write `tree-meta.json`, even though
  // that is where the slug-rule marker lives and a marker recorded here would
  // make it an invariant from the moment the project exists.
  //
  // The file cannot be written this early because its *presence* is the signal
  // `FileStore.loadDocument` uses to decide the folder tree is canonical. A
  // sidecar beside an empty tree makes that empty tree authoritative, so
  // writing one here silently orphans any `prd.md`/`prd.json` that arrives
  // before the first real save — the legacy PRD stops being read at all, with
  // no error and no warning.
  //
  // A new project is covered without it: the write guard and `rex validate`
  // both treat a tree with no items as having nothing a marker could be wrong
  // about, so a fresh project writes, validates and records the marker on its
  // first save. Untangling the two jobs this file does — carrying document
  // facts, and signalling tree ownership — is what would let init record it,
  // and that is a change to the migration path rather than to the guard.

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
