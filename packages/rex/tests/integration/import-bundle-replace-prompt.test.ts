/**
 * The `--replace` prompt tells the truth about what it will destroy.
 *
 * `rex import-bundle --replace` discards every local item. The interactive
 * confirmation is the operator's last chance to stop it, and it quoted
 * `existing.items.length` — the number of *top-level* items. A PRD of 3 epics
 * holding 240 features, tasks and subtasks asked to replace "3 items" and then
 * reported "Replaced 240 items": the guard understated the loss by roughly
 * eightyfold, in the one message whose only job is to convey the scale.
 *
 * The prompt now quotes `countItems`, which is what `mergeBundle` uses for the
 * `replaced` count it reports afterwards, so the two numbers cannot disagree.
 *
 * `confirmReplace` is reached only on a TTY, and only without `--yes`, so these
 * tests force `process.stdin.isTTY` and mock `node:readline` — the same
 * approach as `smart-add-duplicate-outcomes.test.ts`. Asserting the real
 * prompt string through the real call path is the point: a test that recomposed
 * `countItems` itself would pass even if the call site still used `.length`.
 *
 * @see packages/rex/src/cli/commands/import-bundle.ts
 * @see packages/rex/src/core/prd-bundle.ts — countItems, mergeBundle
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cmdInit } from "../../src/cli/commands/init.js";
import { cmdImportBundle } from "../../src/cli/commands/import-bundle.js";
import { resolveStore } from "../../src/store/index.js";
import { REX_DIR } from "../../src/cli/commands/constants.js";
import { SCHEMA_VERSION } from "../../src/schema/index.js";
import type { PRDItem } from "../../src/schema/index.js";

const { prompts, promptAnswers } = vi.hoisted(() => ({
  prompts: [] as string[],
  promptAnswers: [] as string[],
}));

vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (prompt: string, cb: (answer: string) => void) => {
      prompts.push(prompt);
      cb(promptAnswers.shift() ?? "n");
    },
    close: () => {},
  }),
}));

function item(id: string, title: string, level: PRDItem["level"], children?: PRDItem[]): PRDItem {
  return {
    id,
    title,
    level,
    status: "pending",
    priority: "medium",
    acceptanceCriteria: [],
    ...(children ? { children } : {}),
  };
}

/**
 * Two top-level epics holding five items in total.
 *
 * The gap between 2 and 5 is the whole point — a fixture whose top-level count
 * equalled its total could not tell the two implementations apart.
 */
function nestedTree(): PRDItem[] {
  return [
    item("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "First Epic", "epic", [
      item("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "A Feature", "feature", [
        item("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "A Task", "task"),
      ]),
    ]),
    item("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "Second Epic", "epic", [
      item("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "Another Feature", "feature"),
    ]),
  ];
}

const TOP_LEVEL_COUNT = 2;
const TOTAL_COUNT = 5;

describe("rex import-bundle --replace confirmation prompt", () => {
  let projectDir: string;
  let bundlePath: string;
  let originalIsTTY: boolean | undefined;
  let logs: string[];

  beforeEach(async () => {
    prompts.length = 0;
    promptAnswers.length = 0;
    logs = [];

    projectDir = await mkdtemp(join(tmpdir(), "rex-replace-prompt-"));
    await cmdInit(projectDir, {});

    const store = await resolveStore(join(projectDir, REX_DIR));
    await store.withTransaction(async (doc) => {
      doc.items = nestedTree();
    });

    bundlePath = join(projectDir, "bundle.json");
    await writeFile(
      bundlePath,
      JSON.stringify({
        bundle: "rex/prd-bundle",
        bundleVersion: 1,
        schema: SCHEMA_VERSION,
        title: "Replacement PRD",
        exportedAt: "2026-01-01T00:00:00.000Z",
        items: [item("ffffffff-ffff-4fff-8fff-ffffffffffff", "Replacement Epic", "epic")],
      }),
      "utf-8",
    );

    originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.join(" "));
    });
  });

  afterEach(async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  /** The number the prompt actually quoted. */
  function promptedCount(): number {
    expect(prompts, "no confirmation prompt was shown").toHaveLength(1);
    const match = /\((\d+) items?\)/.exec(prompts[0]);
    expect(match, `prompt did not quote a count: ${prompts[0]}`).not.toBeNull();
    return Number(match![1]);
  }

  it("quotes the whole-tree count, not just the top-level items", async () => {
    promptAnswers.push("n");

    await expect(
      cmdImportBundle(projectDir, { in: bundlePath, replace: "true" }),
    ).rejects.toThrow(/Replace declined/);

    expect(promptedCount()).toBe(TOTAL_COUNT);
    expect(promptedCount()).not.toBe(TOP_LEVEL_COUNT);
  });

  it("quotes the same number the outcome line reports as replaced", async () => {
    promptAnswers.push("y");

    await cmdImportBundle(projectDir, { in: bundlePath, replace: "true" });

    const outcome = logs.find((line) => line.includes("Replaced"));
    expect(outcome, `no outcome line in ${JSON.stringify(logs)}`).toBeDefined();

    const reported = Number(/Replaced (\d+) item/.exec(outcome!)![1]);
    expect(reported).toBe(TOTAL_COUNT);
    // The guarantee: the operator was not told one number and charged another.
    expect(promptedCount()).toBe(reported);
  });

  it("declining still leaves the tree untouched", async () => {
    promptAnswers.push("n");

    await expect(
      cmdImportBundle(projectDir, { in: bundlePath, replace: "true" }),
    ).rejects.toThrow(/Replace declined/);

    const store = await resolveStore(join(projectDir, REX_DIR));
    const doc = await store.loadDocument();
    expect(doc.items.map((i) => i.title)).toEqual(["First Epic", "Second Epic"]);
  });

  it("says '1 item' rather than '1 items' for a single-item PRD", async () => {
    const store = await resolveStore(join(projectDir, REX_DIR));
    await store.withTransaction(async (doc) => {
      doc.items = [item("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Only Epic", "epic")];
    });
    promptAnswers.push("n");

    await expect(
      cmdImportBundle(projectDir, { in: bundlePath, replace: "true" }),
    ).rejects.toThrow(/Replace declined/);

    expect(prompts[0]).toContain("(1 item)");
  });

  it("shows no prompt at all when --yes is passed", async () => {
    await cmdImportBundle(projectDir, { in: bundlePath, replace: "true", yes: "true" });

    expect(prompts).toHaveLength(0);
  });
});
