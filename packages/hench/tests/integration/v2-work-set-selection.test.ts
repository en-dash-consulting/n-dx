/**
 * `ndx work` on a branch with a work set (tasks assigned to it with
 * `rex branch add`): autoselection, the menu, the queue-priority peek, `--loop`
 * and `--plan-queue` pick only from the set; `--any` (no `workSetDir`) picks
 * outside it; an explicit `--task` bypasses it; a spent set says so. The
 * default branch and a branch with no assignment select as before.
 *
 * Every test works on a temp copy of rex's v2 fixture in a fresh git repository.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { appendFile, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveStore, isChangeLayerStore } from "@n-dx/rex";
import type { PRDStore } from "@n-dx/rex";
import { getActionableTasks, selectTaskEntry } from "../../src/agent/planning/brief.js";
import {
  branchWorkSet,
  loadV2Tree,
  WORK_SET_EXHAUSTED,
  WorkSetExhaustedError,
} from "../../src/agent/planning/work-selection.js";
import { cmdRun, peekNextTaskPriority, refuseEpicFlagsOnV2 } from "../../src/cli/commands/run.js";
import { cmdPlanQueue } from "../../src/cli/commands/plan-queue.js";
import type { QueuePlan } from "../../src/queue/plan-queue.js";
import { DEFAULT_HENCH_CONFIG } from "../../src/schema/v1.js";
import { RM_RETRY } from "../helpers/index.js";

const FIXTURE = join(import.meta.dirname, "../../../rex/tests/fixtures/v2-tree");
/** CH-1's task "Wire the button": what selection picks with no work set. */
const WIRE_ID = "c0000000-0000-4000-8000-000000000002";
/** A low-priority task this suite adds to CH-1: picked only through the work set. */
const DOCS_ID = "c0000000-0000-4000-8000-0000000000d0";
const BRANCH = "feat/docs";

let root: string;
let rexDir: string;

function git(...args: string[]): string {
  return execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
    cwd: root,
    encoding: "utf-8",
  }).trim();
}

async function store(): Promise<PRDStore> {
  const s = await resolveStore(rexDir);
  expect(isChangeLayerStore(s)).toBe(true);
  return s;
}

/** The unit autoselection picks; `workSetDir` absent is `--any`. */
async function pick(options: { workSetDir?: string; taskId?: string } = {}): Promise<string> {
  const s = await store();
  const tree = (await loadV2Tree(s))!;
  return (await selectTaskEntry((await s.loadDocument()).items, { tree, ...options })).item.id;
}

async function plan(flags: Record<string, string> = {}): Promise<QueuePlan & { workSetBranch?: string }> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await cmdPlanQueue(root, { format: "json", ...flags });
    return JSON.parse(String(log.mock.calls.at(-1)?.[0]));
  } finally {
    log.mockRestore();
  }
}

/** Assign DOCS_ID to {@link BRANCH} and check that branch out. */
async function assignDocsAndCheckout(): Promise<void> {
  await appendFile(
    join(rexDir, "changes", "add-apple-pay", "state.yaml"),
    `  "${DOCS_ID}":\n    delivery: {"branch":"${BRANCH}"}\n`,
  );
  git("add", "-A");
  git("commit", "-q", "-m", "assign docs");
  git("checkout", "-q", "-b", BRANCH);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hench-v2-work-set-"));
  rexDir = join(root, ".rex");
  await cp(FIXTURE, rexDir, { recursive: true });
  await writeFile(join(rexDir, "config.json"), JSON.stringify({ schema: "rex/v1", project: "shop", adapter: "file" }));
  await writeFile(
    join(rexDir, "changes", "add-apple-pay", "write-the-docs.md"),
    `---\nid: "${DOCS_ID}"\ntype: "task"\ntitle: "Write the docs"\nslug: "write-the-docs"\npriority: "low"\n---\n`,
  );
  await mkdir(join(root, ".hench"));
  await writeFile(join(root, ".hench", "config.json"), JSON.stringify(DEFAULT_HENCH_CONFIG()));
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, ...RM_RETRY });
});

describe("selection without a work set is unchanged", () => {
  it("on the default branch", async () => {
    expect(await pick({ workSetDir: root })).toBe(WIRE_ID);
    expect(branchWorkSet((await loadV2Tree(await store()))!, root)).toBeNull();
    expect((await plan()).workSetBranch).toBeUndefined();
  });

  it("on a branch with no assignment", async () => {
    git("checkout", "-q", "-b", "feat/nothing");
    expect(await pick({ workSetDir: root })).toBe(WIRE_ID);
    expect((await getActionableTasks(await store(), 20, undefined, undefined, root)).map((t) => t.id))
      .toEqual([WIRE_ID, DOCS_ID]);
  });

  it("on the default branch even when another branch has a set", async () => {
    await assignDocsAndCheckout();
    git("checkout", "-q", "main");
    expect(await pick({ workSetDir: root })).toBe(WIRE_ID);
  });
});

describe("on a branch with a work set", () => {
  beforeEach(assignDocsAndCheckout);

  it("autoselection picks only from the set; --any picks outside it", async () => {
    expect(await pick({ workSetDir: root })).toBe(DOCS_ID);
    expect(await pick()).toBe(WIRE_ID);
  });

  it("the menu and the queue-priority peek read the same set", async () => {
    const s = await store();
    expect((await getActionableTasks(s, 20, undefined, undefined, root)).map((t) => t.id)).toEqual([DOCS_ID]);
    expect(await peekNextTaskPriority(s, undefined, undefined, undefined, undefined, undefined, undefined, root))
      .toBe("low");
    expect(await peekNextTaskPriority(s)).toBe("high");
  });

  it("an explicit --task outside the set runs", async () => {
    expect(await pick({ workSetDir: root, taskId: WIRE_ID })).toBe(WIRE_ID);
  });

  it("--loop works through the set, then stops on the work-set sentinel", async () => {
    const s = await store();
    expect(await pick({ workSetDir: root })).toBe(DOCS_ID);
    await s.updateItem(DOCS_ID, { status: "completed" });
    const spent = pick({ workSetDir: root });
    await expect(spent).rejects.toBeInstanceOf(WorkSetExhaustedError);
    await expect(spent).rejects.toThrow(WORK_SET_EXHAUSTED);
    expect(WORK_SET_EXHAUSTED).toBe("Nothing left in this branch's work set; --any picks outside it");
    // --any still finds the rest of the PRD.
    expect(await pick()).toBe(WIRE_ID);
  });

  it("an empty set empties the menu", async () => {
    const s = await store();
    await s.updateItem(DOCS_ID, { status: "completed" });
    expect(await getActionableTasks(s, 20, undefined, undefined, root)).toEqual([]);
  });

  it("--plan-queue plans only the set, and --any plans outside it", async () => {
    const inSet = await plan();
    expect(inSet.workSetBranch).toBe(BRANCH);
    expect(inSet.lanes.flatMap((l) => l.tasks.map((t) => t.id))).toEqual([DOCS_ID]);
    const any = await plan({ any: "true" });
    expect(any.workSetBranch).toBeUndefined();
    expect(any.lanes.flatMap((l) => l.tasks.map((t) => t.id)).sort()).toEqual([WIRE_ID, DOCS_ID].sort());
  });

  it("--plan-queue says when the set is spent", async () => {
    await (await store()).updateItem(DOCS_ID, { status: "completed" });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await cmdPlanQueue(root, {});
      expect(log.mock.calls.map((c) => String(c[0]))).toContain(WORK_SET_EXHAUSTED);
    } finally {
      log.mockRestore();
    }
  });

  describe("through `hench run` itself (dry run)", () => {
    /** A configured vendor whose CLI is found, so a dry run reaches selection; node stands in for the binary. */
    beforeEach(async () => {
      await writeFile(join(root, ".n-dx.json"), JSON.stringify({ llm: { vendor: "claude" } }));
      await writeFile(join(root, ".n-dx.local.json"), JSON.stringify({ llm: { claude: { cli_path: process.execPath } } }));
      await writeFile(join(root, ".gitignore"), ".n-dx.local.json\n");
      git("add", "-A");
      git("commit", "-q", "-m", "vendor");
      vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    async function dryRun(flags: Record<string, string>): Promise<string> {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        await cmdRun(root, { ...flags, "dry-run": "true" });
        return log.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
      } finally {
        log.mockRestore();
      }
    }

    it("--auto runs the set's task; with --any, the PRD's next task", async () => {
      // The brief names its unit under "## Current task"; siblings appear elsewhere in it.
      expect(await dryRun({ auto: "true" })).toContain(`ID: ${DOCS_ID}`);
      expect(await dryRun({ auto: "true" })).not.toContain(`ID: ${WIRE_ID}`);
      expect(await dryRun({ auto: "true", any: "true" })).toContain(`ID: ${WIRE_ID}`);
    });

    it("an explicit --task outside the set runs", async () => {
      expect(await dryRun({ auto: "true", task: WIRE_ID })).toContain(`ID: ${WIRE_ID}`);
    });

    it("--loop on a spent set ends cleanly, saying so", async () => {
      await (await store()).updateItem(DOCS_ID, { status: "completed" });
      git("add", "-A");
      git("commit", "-q", "-m", "docs done");
      const out = await dryRun({ loop: "true" });
      expect(out).toContain(`${WORK_SET_EXHAUSTED} — loop finished after 0 task(s).`);
      expect(out).not.toContain("All tasks complete");
    });

    it("--auto on a spent set fails with the work-set message", async () => {
      await (await store()).updateItem(DOCS_ID, { status: "completed" });
      git("add", "-A");
      git("commit", "-q", "-m", "docs done");
      await expect(dryRun({ auto: "true" })).rejects.toThrow(WORK_SET_EXHAUSTED);
    });
  });

  it("--epic-by-epic is still refused: a v2 tree has no epics to walk", async () => {
    const refusal = await refuseEpicFlagsOnV2(rexDir, { "epic-by-epic": "true" });
    expect(refusal?.message).toMatch(/no epic level/);
  });
});
