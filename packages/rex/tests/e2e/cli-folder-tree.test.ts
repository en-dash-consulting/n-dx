/**
 * E2E tests asserting correct folder-tree state after rex CLI write commands.
 *
 * Verifies that `rex add`, `rex update`, `rex remove`, and `rex move` each
 * produce the expected `.rex/prd_tree/` directory structure, and that `rex status`
 * and `rex next` read from the tree rather than hardcoded prd.md paths.
 *
 * All tests use isolated temporary directories and clean up on exit.
 * No test references prd.md paths; all assertions target `.rex/prd_tree/`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PRD_TREE_DIRNAME } from "../../src/store/index.js";

const cliPath = join(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "..",
  "dist",
  "cli",
  "index.js",
);

function run(args: string[], expectFail = false): string {
  try {
    return execFileSync("node", [cliPath, ...args], {
      encoding: "utf-8",
      timeout: 10000,
    });
  } catch (err: unknown) {
    if (expectFail) {
      const e = err as { stderr?: string; stdout?: string };
      return (e.stderr ?? "") + (e.stdout ?? "");
    }
    throw err;
  }
}

/** Extract the UUID from `ID: <uuid>` in command output. */
function extractId(output: string): string {
  const match = output.match(/ID: (.+)/);
  if (!match?.[1]) throw new Error(`No ID found in output: ${output}`);
  return match[1].trim();
}

/** List direct subdirectory names of `dir`. Returns [] when dir is absent. */
async function listSubdirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    const dirs: string[] = [];
    for (const e of entries) {
      try {
        if ((await stat(join(dir, e))).isDirectory()) dirs.push(e);
      } catch {
        /* ignore */
      }
    }
    return dirs;
  } catch {
    return [];
  }
}

/**
 * Find the markdown file that holds an item's content inside `dir` using the
 * same rule the production parser uses: prefer a single non-`index.md` markdown
 * file, otherwise fall back to `index.md`.
 */
async function discoverItemFile(dir: string): Promise<string | undefined> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return undefined;
  }
  const titleNamed = entries.filter((f) => f.endsWith(".md") && f !== "index.md");
  if (titleNamed.length === 1) return join(dir, titleNamed[0]);
  const indexPath = join(dir, "index.md");
  try {
    await stat(indexPath);
    return indexPath;
  } catch {
    return undefined;
  }
}

/** Read the item markdown for the given directory. */
async function readItemMd(dir: string): Promise<string> {
  const path = await discoverItemFile(dir);
  if (!path) throw new Error(`No item markdown file found in ${dir}`);
  return readFile(path, "utf-8");
}

/**
 * Find the immediate subdirectory of `parent` whose item has the given id,
 * by reading the YAML frontmatter `id:` field.
 */
async function findItemDir(parent: string, id: string): Promise<string | undefined> {
  for (const sub of await listSubdirs(parent)) {
    const itemPath = await discoverItemFile(join(parent, sub));
    if (!itemPath) continue;
    const content = await readFile(itemPath, "utf-8");
    if (new RegExp(`^id:\\s*"?${id}"?\\s*$`, "m").test(content)) return sub;
  }
  return undefined;
}

/** Recursively collect all item IDs from a PRD items tree. */
function flattenIds(items: Array<{ id: string; children?: unknown[] }>): string[] {
  const ids: string[] = [];
  for (const item of items) {
    ids.push(item.id);
    if (item.children) {
      ids.push(...flattenIds(item.children as Array<{ id: string; children?: unknown[] }>));
    }
  }
  return ids;
}

// ── Write-command folder-tree state tests ─────────────────────────────────────

describe("rex CLI — folder-tree state after write commands", { timeout: 60_000 }, () => {
  let tmpDir: string;
  let treeRoot: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-e2e-tree-"));
    treeRoot = join(tmpDir, ".rex", PRD_TREE_DIRNAME);
    run(["init", tmpDir]);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("add epic creates an epic directory in .rex/prd_tree/", async () => {
    const out = run(["add", "epic", tmpDir, "--title=Auth System", "--priority=high"]);
    const id = extractId(out);

    const epicDirs = await listSubdirs(treeRoot);
    expect(epicDirs.length).toBe(1);
    const epicDir = await findItemDir(treeRoot, id);
    expect(epicDir).toBeDefined();

    const indexMd = await readItemMd(join(treeRoot, epicDir!));
    expect(indexMd).toContain(`"Auth System"`);
    expect(indexMd).toContain(`"epic"`);
    expect(indexMd).toContain(`"high"`);
  });

  it("add feature creates a subdirectory under the epic directory", async () => {
    const epicOut = run(["add", "epic", tmpDir, "--title=Epic One"]);
    const epicId = extractId(epicOut);

    const featOut = run(["add", "feature", tmpDir, "--title=Feature One", `--parent=${epicId}`]);
    const featId = extractId(featOut);

    const epicDir = (await findItemDir(treeRoot, epicId))!;
    const featDir = await findItemDir(join(treeRoot, epicDir), featId);
    expect(featDir).toBeDefined();

    const featIndexMd = await readItemMd(join(treeRoot, epicDir, featDir!));
    expect(featIndexMd).toContain(`"Feature One"`);

    // Parent epic index.md should list the feature in ## Children table
    const epicIndexMd = await readItemMd(join(treeRoot, epicDir));
    expect(epicIndexMd).toContain("Feature One");
    expect(epicIndexMd).toContain("## Children");
  });

  it("add task creates a subdirectory under the feature directory", async () => {
    const epicOut = run(["add", "epic", tmpDir, "--title=Epic One"]);
    const epicId = extractId(epicOut);
    const featOut = run(["add", "feature", tmpDir, "--title=Feature One", `--parent=${epicId}`]);
    const featId = extractId(featOut);
    const taskOut = run(["add", "task", tmpDir, "--title=Task Alpha", `--parent=${featId}`, "--priority=high"]);
    const taskId = extractId(taskOut);
    // Add a sibling task so the feature has 2 children and isn't collapsed by
    // single-child compaction.
    run(["add", "task", tmpDir, "--title=Task Beta", `--parent=${featId}`]);

    const epicDir = (await findItemDir(treeRoot, epicId))!;
    const featDir = (await findItemDir(join(treeRoot, epicDir), featId))!;
    const taskDir = await findItemDir(join(treeRoot, epicDir, featDir), taskId);
    expect(taskDir).toBeDefined();

    const taskIndexMd = await readItemMd(join(treeRoot, epicDir, featDir, taskDir!));
    expect(taskIndexMd).toContain(`"Task Alpha"`);
    expect(taskIndexMd).toContain(`"high"`);
    expect(taskIndexMd).toContain(`"pending"`);
  });

  it("update --status updates status in the tree index.md", async () => {
    const epicOut = run(["add", "epic", tmpDir, "--title=Epic One"]);
    const epicId = extractId(epicOut);

    run(["update", epicId, tmpDir, "--status=in_progress"]);

    const epicDir = (await findItemDir(treeRoot, epicId))!;
    const indexMd = await readItemMd(join(treeRoot, epicDir));
    expect(indexMd).toContain(`"in_progress"`);
  });

  it("update --title renames slug directory and updates title in index.md", async () => {
    const epicOut = run(["add", "epic", tmpDir, "--title=Old Title"]);
    const epicId = extractId(epicOut);

    run(["update", epicId, tmpDir, "--title=New Title"]);

    // Directory slug reflects the new title; the same item is still findable by id.
    const epicDir = await findItemDir(treeRoot, epicId);
    expect(epicDir).toBeDefined();
    const indexMd = await readItemMd(join(treeRoot, epicDir!));
    expect(indexMd).toContain(`"New Title"`);
    expect(indexMd).not.toContain(`"Old Title"`);
  });

  it("remove epic deletes its directory from .rex/prd_tree/", async () => {
    const epicOut = run(["add", "epic", tmpDir, "--title=To Remove"]);
    const epicId = extractId(epicOut);

    expect(await findItemDir(treeRoot, epicId)).toBeDefined();

    run(["remove", "epic", epicId, tmpDir, "--yes"]);

    expect(await findItemDir(treeRoot, epicId)).toBeUndefined();
  });

  it("remove task deletes its directory from the feature subdirectory", async () => {
    const epicOut = run(["add", "epic", tmpDir, "--title=Epic"]);
    const epicId = extractId(epicOut);
    const featOut = run(["add", "feature", tmpDir, "--title=Feature", `--parent=${epicId}`]);
    const featId = extractId(featOut);
    const taskOut = run(["add", "task", tmpDir, "--title=Task", `--parent=${featId}`]);
    const taskId = extractId(taskOut);
    // Add a sibling task so the feature is not single-child-compacted; the
    // feature directory must exist for this test to verify subdirectory
    // removal.
    run(["add", "task", tmpDir, "--title=Sibling Task", `--parent=${featId}`]);

    const epicDir = (await findItemDir(treeRoot, epicId))!;
    const featDir = (await findItemDir(join(treeRoot, epicDir), featId))!;
    expect(
      await findItemDir(join(treeRoot, epicDir, featDir), taskId),
    ).toBeDefined();

    run(["remove", "task", taskId, tmpDir, "--yes"]);

    expect(
      await findItemDir(join(treeRoot, epicDir, featDir), taskId),
    ).toBeUndefined();
  });

  it("move feature to another epic updates directory structure", async () => {
    const epic1Out = run(["add", "epic", tmpDir, "--title=Epic One"]);
    const epic1Id = extractId(epic1Out);
    const epic2Out = run(["add", "epic", tmpDir, "--title=Epic Two"]);
    const epic2Id = extractId(epic2Out);
    const featOut = run(["add", "feature", tmpDir, "--title=Feature A", `--parent=${epic1Id}`]);
    const featId = extractId(featOut);

    const epic1DirBefore = (await findItemDir(treeRoot, epic1Id))!;
    expect(await findItemDir(join(treeRoot, epic1DirBefore), featId)).toBeDefined();

    run(["move", featId, tmpDir, `--parent=${epic2Id}`]);

    const epic1Dir = (await findItemDir(treeRoot, epic1Id))!;
    const epic2Dir = (await findItemDir(treeRoot, epic2Id))!;

    // Feature no longer under epic1
    expect(await findItemDir(join(treeRoot, epic1Dir), featId)).toBeUndefined();
    // Feature is now under epic2
    expect(await findItemDir(join(treeRoot, epic2Dir), featId)).toBeDefined();
  });

  it("adding multiple epics creates one directory per epic", async () => {
    const ids: string[] = [];
    for (const title of ["Alpha", "Beta", "Gamma"]) {
      const out = run(["add", "epic", tmpDir, `--title=${title}`]);
      ids.push(extractId(out));
    }

    const epicDirs = await listSubdirs(treeRoot);
    expect(epicDirs.length).toBe(3);
    for (const id of ids) {
      expect(await findItemDir(treeRoot, id)).toBeDefined();
    }
  });
});

// ── Pipeline tests: add items → status/next read from tree ───────────────────

describe("rex CLI — status and next read from folder tree", { timeout: 60_000 }, () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-e2e-tree-pipeline-"));
    run(["init", tmpDir]);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("full pipeline: add items → status reads tree → next selects pending task", () => {
    const epicOut = run(["add", "epic", tmpDir, "--title=Pipeline Epic", "--priority=high"]);
    const epicId = extractId(epicOut);
    const featOut = run(["add", "feature", tmpDir, "--title=Pipeline Feature", `--parent=${epicId}`]);
    const featId = extractId(featOut);
    run([
      "add",
      "task",
      tmpDir,
      "--title=Task Completed",
      `--parent=${featId}`,
      "--status=completed",
    ]);
    const pendingOut = run(["add", "task", tmpDir, "--title=Task Pending", `--parent=${featId}`, "--priority=high"]);
    const pendingId = extractId(pendingOut);

    // status reads items from tree (not from prd.md)
    const statusJson = run(["status", tmpDir, "--format=json"]);
    const doc = JSON.parse(statusJson);
    expect(doc.schema).toBe("rex/v1");
    const allIds = flattenIds(doc.items);
    expect(allIds).toContain(epicId);
    expect(allIds).toContain(featId);
    expect(allIds).toContain(pendingId);

    // next selects the pending task (not the completed one)
    const nextJson = run(["next", tmpDir, "--format=json"]);
    const nextResult = JSON.parse(nextJson);
    expect(nextResult.item.id).toBe(pendingId);
    expect(nextResult.item.title).toBe("Task Pending");
  });

  it("validate passes on a valid folder-tree PRD", () => {
    const epicOut = run(["add", "epic", tmpDir, "--title=Valid Epic"]);
    const epicId = extractId(epicOut);
    const featOut = run(["add", "feature", tmpDir, "--title=Valid Feature", `--parent=${epicId}`]);
    const featId = extractId(featOut);
    run(["add", "task", tmpDir, "--title=Valid Task", `--parent=${featId}`]);

    const output = run(["validate", tmpDir]);
    expect(output).toContain("All checks passed");
  });

  it("status --format=json reflects correct item count from folder tree", () => {
    const epicOut = run(["add", "epic", tmpDir, "--title=Count Test"]);
    const epicId = extractId(epicOut);
    const featOut = run(["add", "feature", tmpDir, "--title=Feature A", `--parent=${epicId}`]);
    const featId = extractId(featOut);
    run(["add", "task", tmpDir, "--title=Task 1", `--parent=${featId}`]);
    run(["add", "task", tmpDir, "--title=Task 2", `--parent=${featId}`]);

    const statusJson = run(["status", tmpDir, "--format=json"]);
    const doc = JSON.parse(statusJson);
    const allIds = flattenIds(doc.items);
    // epic + feature + 2 tasks = 4 items
    expect(allIds.length).toBe(4);
  });

  it("next returns COMPLETE when all tasks in tree are done", () => {
    const epicOut = run(["add", "epic", tmpDir, "--title=Done Epic"]);
    const epicId = extractId(epicOut);
    const featOut = run(["add", "feature", tmpDir, "--title=Done Feature", `--parent=${epicId}`]);
    const featId = extractId(featOut);
    const taskOut = run(["add", "task", tmpDir, "--title=The Only Task", `--parent=${featId}`]);
    const taskId = extractId(taskOut);
    run(["update", taskId, tmpDir, "--status=completed"]);

    const output = run(["next", tmpDir]);
    expect(output).toContain("COMPLETE");
  });

  it("status tree output reflects correct status after update", () => {
    const epicOut = run(["add", "epic", tmpDir, "--title=Status Epic"]);
    const epicId = extractId(epicOut);
    run(["update", epicId, tmpDir, "--status=in_progress"]);

    const output = run(["status", tmpDir, "--format=tree"]);
    expect(output).toContain("Status Epic");

    const json = run(["status", tmpDir, "--format=json"]);
    const doc = JSON.parse(json);
    const epic = doc.items.find((i: { id: string }) => i.id === epicId);
    expect(epic?.status).toBe("in_progress");
  });
});
