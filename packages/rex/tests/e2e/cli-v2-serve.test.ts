/**
 * E2E: the v1 CLI commands serve a v2 tree through the change-layer store.
 * `recommend --accept` creates a change per finding rather than an epic; the
 * one that still cannot serve a v2 tree (restore) refuses with a sentence
 * naming what to use instead.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SCHEMA_VERSION, type ItemStatus, type PRDItem } from "../../src/schema/index.js";
import { toCanonicalJSON } from "../../src/core/canonical.js";
import { serializeFolderTree } from "../../src/store/index.js";
import { copyV2Fixture } from "../helpers/v2-fixture.js";

const cliPath = join(fileURLToPath(import.meta.url), "..", "..", "..", "dist", "cli", "index.js");

const CHANGE = "c0000000-0000-4000-8000-000000000001";
const TASK = "c0000000-0000-4000-8000-000000000002";

function run(args: string[], cwd: string, expectFail = false): string {
  const proc = spawnSync("node", [cliPath, ...args], { cwd, encoding: "utf-8", timeout: 20000, stdio: ["ignore", "pipe", "pipe"] });
  const output = (proc.stdout ?? "") + (proc.stderr ?? "");
  if (proc.status !== 0 && !expectFail) throw new Error(`rex ${args.join(" ")} exited ${proc.status}:\n${output}`);
  if (proc.status === 0 && expectFail) throw new Error(`rex ${args.join(" ")} should have failed:\n${output}`);
  return output;
}

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rex-cli-v2-serve-"));
  await copyV2Fixture(join(tmp, ".rex"), "lf");
  // `rex init` writes this; the fixture is the tree alone.
  await writeFile(
    join(tmp, ".rex", "config.json"),
    toCanonicalJSON({ schema: SCHEMA_VERSION, project: "t", adapter: "file" }),
  );
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const taskFile = () => join(tmp, ".rex", "changes", "add-apple-pay", "wire-the-button.md");
const stateFile = () => join(tmp, ".rex", "changes", "add-apple-pay", "state.yaml");

interface SourceVisionFinding {
  severity: string;
  category: string;
  message: string;
}

/** The one file `rex recommend` reads findings from. */
async function writeSourceVisionFindings(findings: SourceVisionFinding[]): Promise<void> {
  await mkdir(join(tmp, ".sourcevision"), { recursive: true });
  await writeFile(join(tmp, ".sourcevision", "zones.json"), JSON.stringify({ findings }), "utf-8");
}

interface TreeItem {
  title: string;
  children?: TreeItem[];
}

function flatten(items: readonly TreeItem[]): TreeItem[] {
  return items.flatMap((item) => [item, ...flatten(item.children ?? [])]);
}

describe("rex on a v2 tree", () => {
  it("status shows the change and its task", () => {
    const out = run(["status", tmp], tmp);
    expect(out).toContain("Add Apple Pay");
    expect(out).toContain("Wire the button");
  });

  it("tree lists the change with its task", () => {
    const out = run(["tree", tmp], tmp);
    expect(out).toContain("Add Apple Pay");
    expect(out).toContain("Wire the button");
  });

  it("ready runs (no item has an automated requirement to report)", () => {
    expect(run(["ready", tmp], tmp)).toContain("No items qualify");
  });

  it("update writes the task's status to state.yaml", async () => {
    run(["update", TASK, "--status=in_progress", tmp], tmp);
    expect(await readFile(stateFile(), "utf-8")).toMatch(new RegExp(`"${TASK}":\\s+status: "in_progress"`));
  });

  it("update completes the task", async () => {
    run(["update", TASK, "--status=completed", tmp], tmp);
    expect(await readFile(stateFile(), "utf-8")).toMatch(new RegExp(`"${TASK}":\\s+status: "completed"`));
  });

  it("move reparents a task into another change", async () => {
    const added = JSON.parse(run(["add", "change", "--title=Tidy the card form", "--format=json", tmp], tmp));
    const id = (Array.isArray(added) ? added[0] : added).id as string;
    expect(id).toBeDefined();
    run(["move", TASK, `--parent=${id}`, tmp], tmp);
    expect(existsSync(taskFile())).toBe(false);
    expect(run(["tree", tmp], tmp)).toMatch(/Tidy the card form[\s\S]*Wire the button/);
  });

  // The level rule refuses this (a root change reads as an epic); the type rule allows it.
  it("move nests a change under another change", async () => {
    const added = JSON.parse(run(["add", "change", "--title=Tidy the card form", "--format=json", tmp], tmp));
    const id = (Array.isArray(added) ? added[0] : added).id as string;
    run(["move", id, `--parent=${CHANGE}`, tmp], tmp);
    const changes = join(tmp, ".rex", "changes");
    expect(existsSync(join(changes, "tidy-the-card-form"))).toBe(false);
    expect(existsSync(join(changes, "add-apple-pay", "tidy-the-card-form"))).toBe(true);
  });

  it("move refuses to put a change under a task, and leaves the tree alone", async () => {
    run(["move", CHANGE, `--parent=${TASK}`, tmp], tmp, true);
    expect(existsSync(taskFile())).toBe(true);
  });

  it("remove deletes the task", () => {
    run(["remove", TASK, "--yes", tmp], tmp);
    expect(existsSync(taskFile())).toBe(false);
  });

  it("verify runs", () => {
    run(["verify", tmp], tmp);
  });

  it("fix runs", () => {
    run(["fix", tmp], tmp);
  });

  it("validate passes", () => {
    run(["validate", tmp], tmp);
  });

  it("validate passes with a change nested two deep and a task-less change, with no v1 placement or empty-container finding", () => {
    const add = (title: string): string => {
      const added = JSON.parse(run(["add", "change", `--title=${title}`, "--format=json", tmp], tmp));
      return (Array.isArray(added) ? added[0] : added).id as string;
    };
    const mid = add("Tidy the card form");
    const leaf = add("Tidy the card form further");
    run(["move", mid, `--parent=${CHANGE}`, tmp], tmp);
    run(["move", leaf, `--parent=${mid}`, tmp], tmp);
    const out = run(["validate", tmp], tmp);
    expect(out).not.toContain("hierarchy placement");
    expect(out).not.toContain("empty containers");
  });

  it("report passes", () => {
    run(["report", tmp], tmp);
  });

  it("report --fail-on-error passes with a change nested two deep and a task-less change, with no v1 placement or empty-container check", () => {
    const add = (title: string): string => {
      const added = JSON.parse(run(["add", "change", `--title=${title}`, "--format=json", tmp], tmp));
      return (Array.isArray(added) ? added[0] : added).id as string;
    };
    const mid = add("Tidy the card form");
    const leaf = add("Tidy the card form further");
    run(["move", mid, `--parent=${CHANGE}`, tmp], tmp);
    run(["move", leaf, `--parent=${mid}`, tmp], tmp);
    const report = JSON.parse(run(["report", "--fail-on-error", "--format=json", tmp], tmp));
    expect(report.ok).toBe(true);
    const names = report.validation.checks.map((c: { name: string }) => c.name);
    expect(names).not.toContain("hierarchy placement");
    expect(names).not.toContain("empty containers");
  });

  it("recommend --accept creates a change per finding, and no epic", async () => {
    await writeSourceVisionFindings([
      { severity: "warning", category: "auth", message: "Token is read twice" },
      { severity: "warning", category: "perf", message: "Inventory is scanned per file" },
    ]);

    const out = run(["recommend", "--accept", tmp], tmp);

    // What was created, not the recommendation listing printed above it.
    const created = out.slice(out.indexOf("Creating 2 changes"));
    expect(created).toContain("Created change: Fix auth in global: Token is read twice");
    expect(created).toContain("Created change: Fix perf in global: Inventory is scanned per file");
    // The run's epic and its zone+category features are containers; v2 has none.
    expect(created).not.toContain("Code Health:");
    expect(created).not.toMatch(/Created (epic|feature)/);

    const tree = JSON.parse(run(["tree", "--format=json", tmp], tmp)) as { items: TreeItem[] };
    const titles = flatten(tree.items).map((i) => i.title);
    expect(titles).toContain("Fix auth in global: Token is read twice");
    expect(titles).toContain("Fix perf in global: Inventory is scanned per file");
    expect(titles).not.toContain("Code Health: 2 findings across 1 zone");
    // Written to the change layer's Inbox, not as a v1 tree beside it.
    expect(existsSync(join(tmp, ".rex", "prd_tree"))).toBe(false);
    expect(existsSync(join(tmp, ".rex", "changes", "inbox"))).toBe(true);
  });

  it("recommend --accept ranks each new change against the product map", async () => {
    await writeSourceVisionFindings([
      { severity: "warning", category: "card", message: "A declined card is charged twice by the shopper basket" },
    ]);

    const out = run(["recommend", "--accept", tmp], tmp);
    const created = out.slice(out.indexOf("Creating 1 change"));

    expect(created).toContain("Placement: Inbox (needs placement). Suggested, best first:");
    expect(created).toContain("A1.1 Pay by card");
    expect(created).toMatch(/rex change place \S+ --target=A1\.1 --relation=(touches|amends)/);
  });

  it("analyze --accept creates changes for the gaps and no epic", async () => {
    await mkdir(join(tmp, "tests"), { recursive: true });
    await writeFile(
      join(tmp, "tests", "billing.test.ts"),
      'describe("Billing", () => { it("processes payments", () => {}); });\n',
    );

    const out = run(["analyze", "--no-llm", "--accept", tmp], tmp);

    // The proposed feature has no tasks, so it is the deepest node naming
    // work and becomes the change; its epic is a container and is not created.
    expect(out).toContain("Created change: General Tests");
    expect(out).toMatch(/Added \d+ changes? to the Inbox\./);
    expect(out).not.toMatch(/Created (epic|feature)/);
    expect(existsSync(join(tmp, ".rex", "prd_tree"))).toBe(false);

    const tree = JSON.parse(run(["tree", "--format=json", tmp], tmp)) as { items: TreeItem[] };
    const titles = flatten(tree.items).map((i) => i.title);
    expect(titles).toContain("General Tests");
    expect(titles).not.toContain("General");
  });

  it("analyze --accept makes a decomposed task's proposed subtasks tasks under its change", async () => {
    await writeFile(join(tmp, ".rex", "pending-proposals.json"), JSON.stringify([{
      epic: { title: "Billing", source: "llm" },
      features: [{
        title: "Refunds",
        source: "llm",
        tasks: [{
          title: "Refund to the card",
          source: "llm",
          sourceFile: "src/refund.ts",
          priority: "high",
          tags: ["billing"],
          acceptanceCriteria: ["A refund reaches the card"],
          decomposition: {
            thresholdWeeks: 2,
            children: [
              { title: "Call the gateway's refund API", source: "llm", sourceFile: "src/refund.ts", acceptanceCriteria: ["The API answers ok"] },
              { title: "Show the refund on the receipt", source: "llm", sourceFile: "src/receipt.ts" },
            ],
          },
        }],
      }],
    }]));

    const out = run(["analyze", "--accept", tmp], tmp);
    expect(out).toMatch(/Added 1 change to the Inbox, with 2 proposed subtasks as their tasks\./);

    const tree = JSON.parse(run(["tree", "--format=json", tmp], tmp)) as { items: Array<TreeItem & { type?: string; needsPlacement?: boolean; priority?: string; source?: string }> };
    const change = flatten(tree.items).find((i) => i.title === "Refund to the card") as (typeof tree.items)[number];
    expect(change).toMatchObject({ type: "change", needsPlacement: true, priority: "high", source: "llm" });
    expect((change.children ?? []).map((c) => c.title)).toEqual([
      "Call the gateway's refund API",
      "Show the refund on the receipt",
    ]);
  });

  it("restore refuses, saying it is v1-only", async () => {
    const out = run(["restore", tmp], tmp, true);
    expect(out).toMatch(/v1/);
  });

  it("migrate-to-folder-tree refuses a leftover prd.md and writes no prd_tree/", async () => {
    await writeFile(join(tmp, ".rex", "prd.md"), "---\nid: x\ntitle: Legacy\nschema: rex/v1\n---\n");
    const out = run(["migrate-to-folder-tree", tmp], tmp, true);
    expect(out).toContain("v2");
    expect(existsSync(join(tmp, ".rex", "prd_tree"))).toBe(false);
  });

  it("migrate-to-md refuses a leftover prd.json and writes no prd.md", async () => {
    await writeFile(join(tmp, ".rex", "prd.json"), JSON.stringify({ schema: SCHEMA_VERSION, title: "Legacy", items: [] }));
    const out = run(["migrate-to-md", tmp], tmp, true);
    expect(out).toContain("v2");
    expect(existsSync(join(tmp, ".rex", "prd.md"))).toBe(false);
  });

  it("migrate-folder-tree-filenames refuses and creates no prd_tree/", () => {
    const out = run(["migrate-folder-tree-filenames", tmp], tmp, true);
    expect(out).toContain("v2");
    expect(existsSync(join(tmp, ".rex", "prd_tree"))).toBe(false);
  });
});

/** The v2 change and task as v1 items, with stale titles and the given statuses. */
const staleItems = (changeStatus: ItemStatus, taskStatus: ItemStatus): PRDItem[] => [
  {
    id: CHANGE,
    title: "STALE v1 title",
    level: "epic",
    status: changeStatus,
    children: [{ id: TASK, title: "STALE task", level: "task", status: taskStatus }],
  },
];

/** The read commands, as [name, args] rows. */
const READS: [string, string[]][] = [["status"], ["status", "--all"], ["tree"]].map((args) => [args.join(" "), args]);

describe("rex on a v2 tree with a stray same-id prd.json", () => {
  beforeEach(async () => {
    await writeFile(
      join(tmp, ".rex", "prd.json"),
      JSON.stringify({ schema: SCHEMA_VERSION, title: "stale", items: staleItems("completed", "completed") }),
    );
  });
  const expectNoSplit = () => {
    expect(existsSync(join(tmp, ".rex", "prd_tree"))).toBe(false);
    expect(existsSync(join(tmp, ".rex", "prd.json.migrated"))).toBe(false);
  };

  it.each(READS)("%s shows the v2 titles and scaffolds no prd_tree/", (_name, args) => {
    const out = run([...args, tmp], tmp);
    expect(out).toContain("Add Apple Pay");
    expect(out).toContain("Wire the button");
    expect(out).not.toContain("STALE");
    expectNoSplit();
  });

  it("next answers the pending v2 task and scaffolds no prd_tree/", () => {
    const out = run(["next", tmp], tmp);
    expect(out).toContain("Wire the button");
    expect(out).not.toContain("COMPLETE");
    expectNoSplit();
  });
});

describe("rex on a v2 tree with a stray same-id prd_tree/", () => {
  const strayTree = (items: PRDItem[]) => serializeFolderTree(items, join(tmp, ".rex", "prd_tree"));

  it.each(READS)("%s shows the v2 titles", async (_name, args) => {
    await strayTree(staleItems("completed", "completed"));
    const out = run([...args, tmp], tmp);
    expect(out).toContain("Add Apple Pay");
    expect(out).toContain("Wire the button");
    expect(out).not.toContain("STALE");
  });

  it("next answers the pending v2 task", async () => {
    await strayTree(staleItems("completed", "completed"));
    const out = run(["next", tmp], tmp);
    expect(out).toContain("Wire the button");
    expect(out).not.toContain("COMPLETE");
  });

  it("validate does not judge a stray tree named from other titles", async () => {
    await strayTree(staleItems("completed", "completed"));
    const out = run(["validate", tmp], tmp);
    expect(out).not.toContain("tree slug convention");
    expect(out).not.toContain("tree slug rule marker");
    expect(out).not.toContain("tree identity");
    expect(out).not.toContain("migrate-slugs");
  });

  it("validate checks the change layer's statuses, not the stray tree's", async () => {
    // Overlaid, the stale statuses would make the in-progress change a
    // completed parent of a pending task.
    const [change] = staleItems("completed", "pending");
    await strayTree([{ ...change, title: "Add Apple Pay", children: [{ ...change.children![0], title: "Wire the button" }] }]);
    const out = run(["validate", tmp], tmp);
    expect(out).not.toContain("parent-child status consistency");
    expect(out).toContain(`"${CHANGE}": in_progress`);
  });
});
