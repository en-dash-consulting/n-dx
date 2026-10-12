/**
 * The agent brief on a v2 tree (product/ + changes/).
 *
 * On v2 the brief is rex's change brief (`buildChangeBrief`): the work item,
 * its change, and the capabilities and constraints the change touches or
 * amends — not the v1 parent chain over the projected change layer. Hench adds
 * only what is its own: the commit trailers and the session filters.
 *
 * Every test works on a temp copy of rex's v2 fixture, so writes never touch it.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildChangeBrief, resolveStore, resolveWorkById, isChangeLayerStore } from "@n-dx/rex";
import type { PRDStore } from "@n-dx/rex";
import { assembleTaskBrief, formatTaskBrief } from "../../src/agent/planning/brief.js";
import { loadV2Tree } from "../../src/agent/planning/work-selection.js";
import { RM_RETRY } from "../helpers/index.js";

const FIXTURE = join(import.meta.dirname, "../../../rex/tests/fixtures/v2-tree");

/** The fixture's task "Wire the button", in change CH-1 ("Add Apple Pay"). */
const WIRE_ID = "c0000000-0000-4000-8000-000000000002";

let root: string;
let rexDir: string;

async function store(): Promise<PRDStore> {
  const s = await resolveStore(rexDir);
  expect(isChangeLayerStore(s)).toBe(true);
  return s;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hench-v2-brief-"));
  rexDir = join(root, ".rex");
  await cp(FIXTURE, rexDir, { recursive: true });
  await writeFile(
    join(rexDir, "config.json"),
    JSON.stringify({ schema: "rex/v1", project: "shop", adapter: "file", validate: "pnpm lint", test: "pnpm test" }),
  );
  await writeFile(join(rexDir, "workflow.md"), "Write the test first.\n");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, ...RM_RETRY });
});

describe("v2 brief", () => {
  it("is rex's buildChangeBrief for the selected unit", async () => {
    const s = await store();
    const { brief, taskId } = await assembleTaskBrief(s, WIRE_ID);
    expect(taskId).toBe(WIRE_ID);

    const tree = await loadV2Tree(s);
    const unit = resolveWorkById(tree!, WIRE_ID)!;
    const expected = buildChangeBrief({
      tree: tree!,
      unit,
      workflow: "Write the test first.\n",
      recentLog: await s.readLog(20),
    });
    expect(brief.changeBrief).toEqual(expected.sections.map((sec) => ({ name: sec.name, text: sec.text })));
  });

  it("carries the change and the capability it amends, not the v1 parent chain", async () => {
    const { brief } = await assembleTaskBrief(await store(), WIRE_ID);
    const text = formatTaskBrief(brief);

    expect(text).toContain("Wire the button");
    expect(text).toContain("The button appears on Safari only");
    expect(text).toContain("Add Apple Pay");
    expect(text).toContain("Pay by card");
    expect(text).toContain("Apple Pay is offered on Safari");
    expect(text).toContain("Write the test first.");
    expect(text).not.toContain("## Context (Parent Chain)");
    // The project's commands are the system prompt's, as on v1.
    expect(text).not.toContain("pnpm lint");
  });

  it("keeps hench's commit trailers directly after the task section", async () => {
    const { brief } = await assembleTaskBrief(await store(), WIRE_ID);
    const text = formatTaskBrief({ ...brief, commitTrailers: [`N-DX-Item: ${WIRE_ID}`] });

    const task = brief.changeBrief!.find((sec) => sec.name === "task")!;
    const trailers = text.indexOf("## Commit Trailers");
    expect(text.startsWith(task.text)).toBe(true);
    expect(trailers).toBeGreaterThan(task.text.length - 1);
    expect(trailers).toBeLessThan(text.indexOf("Add Apple Pay", task.text.length));
    expect(text).toContain(`N-DX-Item: ${WIRE_ID}`);
  });

  it("keeps the session filters", async () => {
    const { brief } = await assembleTaskBrief(await store(), WIRE_ID, { tags: ["checkout"] });
    expect(formatTaskBrief(brief)).toContain("Active tag filter: checkout");
  });
});
