/**
 * `ndx work` selection on a v2 tree (product/ + changes/).
 *
 * hench selects with rex's v2 selector — the entry point `get_next_task` uses
 * — rather than the v1 findNextTask over the projected change layer; `--task`
 * takes an id or a display id; a loop moves on as units complete and ends on
 * the "No actionable tasks" sentinel; the epic flags are refused.
 *
 * Every test works on a temp copy of rex's v2 fixture, so writes never touch it.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { appendFile, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectCompletedIds, findNextTask, findNextWork, resolveStore, isChangeLayerStore } from "@n-dx/rex";
import type { PRDStore } from "@n-dx/rex";
import { assembleTaskBrief, getActionableTasks, selectTaskEntry } from "../../src/agent/planning/brief.js";
import { loadV2Tree } from "../../src/agent/planning/work-selection.js";
import { peekNextTaskPriority, refuseEpicFlagsOnV2 } from "../../src/cli/commands/run.js";
import { RM_RETRY } from "../helpers/index.js";

const FIXTURE = join(import.meta.dirname, "../../../rex/tests/fixtures/v2-tree");

/** The fixture's change, CH-1 (in_progress, high priority). */
const CHANGE_ID = "c0000000-0000-4000-8000-000000000001";
/** Its task "Wire the button" (pending). */
const WIRE_ID = "c0000000-0000-4000-8000-000000000002";
/** A second task this suite adds to CH-1. */
const DOCS_ID = "c0000000-0000-4000-8000-0000000000d0";
/** An Inbox change (needsPlacement) and its task, added by one test. */
const INBOX_ID = "c0000000-0000-4000-8000-0000000000e0";
const INBOX_TASK_ID = "c0000000-0000-4000-8000-0000000000e1";

let root: string;
let rexDir: string;

/** Adds DOCS_ID to CH-1; `extra` is intent frontmatter, `assignee` goes to state.yaml (tool state on v2). */
async function addDocsTask(extra = "", assignee?: string): Promise<void> {
  if (assignee) {
    await appendFile(
      join(rexDir, "changes", "add-apple-pay", "state.yaml"),
      `  "${DOCS_ID}":\n    assignee: "${assignee}"\n`,
    );
  }
  await writeFile(
    join(rexDir, "changes", "add-apple-pay", "write-the-docs.md"),
    [
      "---",
      `id: "${DOCS_ID}"`,
      'type: "task"',
      'title: "Write the docs"',
      'slug: "write-the-docs"',
      ...(extra ? [extra] : []),
      "---",
      "",
    ].join("\n"),
  );
}

async function store(): Promise<PRDStore> {
  const s = await resolveStore(rexDir);
  expect(isChangeLayerStore(s)).toBe(true);
  return s;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hench-v2-select-"));
  rexDir = join(root, ".rex");
  await cp(FIXTURE, rexDir, { recursive: true });
  // The brief reads the project config; the fixture holds only the tree.
  await writeFile(join(rexDir, "config.json"), JSON.stringify({ schema: "rex/v1", project: "shop", adapter: "file" }));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, ...RM_RETRY });
});

describe("v2 autoselection", () => {
  it("picks the unit rex's findNextWork picks, through the brief", async () => {
    const s = await store();
    const tree = (await loadV2Tree(s))!;
    const expected = findNextWork(tree)!.node.id;
    expect(expected).toBe(WIRE_ID);

    const { taskId, brief } = await assembleTaskBrief(s);
    expect(taskId).toBe(expected);
    expect(brief.parentChain.map((p) => p.id)).toEqual([CHANGE_ID]);
  });

  it("passes over an Inbox change the v1 selector over the projection would run", async () => {
    // A critical change awaiting placement, with a pending task. The projection
    // reads it as a critical epic; only v2 selection knows the Inbox is not run.
    const inbox = join(rexDir, "changes", "triage-me");
    await mkdir(inbox);
    await writeFile(join(inbox, "index.md"), [
      "---", `id: "${INBOX_ID}"`, 'type: "change"', 'title: "Triage me"', 'slug: "triage-me"',
      'priority: "critical"', "---", "",
    ].join("\n"));
    await writeFile(join(inbox, "do-it.md"), [
      "---", `id: "${INBOX_TASK_ID}"`, 'type: "task"', 'title: "Do it"', 'slug: "do-it"', "---", "",
    ].join("\n"));
    await writeFile(join(inbox, "state.yaml"), `schema: "rex/v2"\nitems:\n  "${INBOX_ID}":\n    needsPlacement: true\n`);

    const s = await store();
    const items = (await s.loadDocument()).items;
    // Guard: the projection alone would pick the Inbox task.
    expect(findNextTask(items, collectCompletedIds(items))?.item.id).toBe(INBOX_TASK_ID);

    const { taskId } = await assembleTaskBrief(s);
    expect(taskId).toBe(WIRE_ID);
    expect(taskId).toBe(findNextWork((await loadV2Tree(s))!)!.node.id);
    // Asked for by name, an Inbox task is refused: rex will not close it.
    await expect(assembleTaskBrief(s, INBOX_TASK_ID)).rejects.toThrow(/needs placement/);
  });

  it("honours --tags and --mine with rex's own rules", async () => {
    await addDocsTask('tags: ["docs"]', "Ada <ada@example.com>");
    const s = await store();
    const tree = (await loadV2Tree(s))!;
    const items = (await s.loadDocument()).items;

    expect((await selectTaskEntry(items, { tree, tags: ["docs"] })).item.id).toBe(DOCS_ID);
    expect((await selectTaskEntry(items, { tree, assignee: "Ada <ada@example.com>" })).item.id).toBe(DOCS_ID);
    await expect(selectTaskEntry(items, { tree, assignee: "Bob <bob@example.com>" }))
      .rejects.toThrow("No actionable tasks found in PRD");
  });

  it("passes over excluded (stuck or claimed) units", async () => {
    await addDocsTask();
    const s = await store();
    const tree = (await loadV2Tree(s))!;
    const items = (await s.loadDocument()).items;
    const entry = await selectTaskEntry(items, { tree, excludeTaskIds: new Set([WIRE_ID]) });
    expect(entry.item.id).toBe(DOCS_ID);
  });

  it("peeks the same unit for queue priority and lists it first in the menu", async () => {
    const s = await store();
    // The task inherits its change's high priority.
    expect(await peekNextTaskPriority(s)).toBe("high");
    const menu = await getActionableTasks(s);
    expect(menu.map((t) => t.id)).toEqual([WIRE_ID]);
  });
});

describe("v2 --task", () => {
  it("accepts an id", async () => {
    const { taskId } = await assembleTaskBrief(await store(), WIRE_ID);
    expect(taskId).toBe(WIRE_ID);
  });

  it("accepts a change's display id and runs the change's open task", async () => {
    const s = await store();
    const { taskId } = await assembleTaskBrief(s, "CH-1");
    expect(taskId).toBe(WIRE_ID);
    // The task sets no priority, so it is scheduled at its change's.
    expect(await peekNextTaskPriority(s, "CH-1")).toBe("high");
    expect(await peekNextTaskPriority(s, WIRE_ID)).toBe("high");
  });

  it("refuses a ref that names nothing", async () => {
    await expect(assembleTaskBrief(await store(), "CH-404")).rejects.toThrow("Task not found: CH-404");
  });
});

describe("v2 --loop", () => {
  it("moves to the next unit as each completes, then reports none left", async () => {
    await addDocsTask();
    const s = await store();
    const seen: string[] = [];
    for (let i = 0; i < 2; i++) {
      const { taskId } = await assembleTaskBrief(s);
      seen.push(taskId);
      await s.updateItem(taskId, { status: "completed" });
    }
    expect(seen).toEqual([WIRE_ID, DOCS_ID]);
    // The sentinel runLoop reads as "done".
    await expect(assembleTaskBrief(s)).rejects.toThrow("No actionable tasks found in PRD");
  });
});

describe("v2 epic flags", () => {
  it("refuses --epic-by-epic, naming the missing epic level", async () => {
    const refusal = await refuseEpicFlagsOnV2(rexDir, { "epic-by-epic": "true" });
    expect(refusal?.message).toMatch(/--epic-by-epic/);
    expect(refusal?.message).toMatch(/no epic level/);
  });

  it("refuses --epic for the same reason", async () => {
    const refusal = await refuseEpicFlagsOnV2(rexDir, { epic: "anything" });
    expect(refusal?.message).toMatch(/Cannot use --epic on this PRD: .*no epic level/);
  });

  it("leaves a v1 tree's epic flags alone", async () => {
    await rm(join(rexDir, "product"), { recursive: true });
    expect(await refuseEpicFlagsOnV2(rexDir, { "epic-by-epic": "true" })).toBeUndefined();
  });

  it("refuses an epic scope inside selection too", async () => {
    const s = await store();
    const tree = (await loadV2Tree(s))!;
    await expect(selectTaskEntry((await s.loadDocument()).items, { tree, epicId: "e1" }))
      .rejects.toThrow(/no epic level/);
  });
});
