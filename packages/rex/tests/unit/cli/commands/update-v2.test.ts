/**
 * `rex update --status=completed` on a v2 tree completes through the same
 * path as update_task_status (cli/v2-completion.ts), on temp copies of the v2
 * fixture.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cmdUpdate } from "../../../../src/cli/commands/update.js";
import { handleUpdateTaskStatus } from "../../../../src/cli/mcp-tools/index.js";
import { DEFAULT_CONFIG } from "../../../../src/schema/index.js";
import { indexTree } from "../../../../src/schema/v2-rules.js";
import { resolveStore } from "../../../../src/store/index.js";
import { loadPrdModel } from "../../../../src/store/prd-model-reader.js";
import { copyV2Fixture, editText } from "../../../helpers/v2-fixture.js";

const CHANGE = "c0000000-0000-4000-8000-000000000001";
const TASK = "c0000000-0000-4000-8000-000000000002";
const quiet = { env: {}, warn: () => {} };

/** A git project holding the v2 fixture, its change pending so completing its task closes it. */
async function project(): Promise<string> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "rex-update-v2-")));
  execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: dir });
  const rexDir = await copyV2Fixture(join(dir, ".rex"), "lf");
  await writeFile(join(rexDir, "config.json"), JSON.stringify(DEFAULT_CONFIG("shop")));
  await editText(join(rexDir, "changes/add-apple-pay/state.yaml"), (t) => t.replace('status: "in_progress"', 'status: "pending"'));
  return dir;
}

/** Every node's status, applied flag and resolution, plus the product layer: what a completion decides. */
async function outcome(dir: string) {
  const { tree } = await loadPrdModel(join(dir, ".rex"), quiet);
  return {
    nodes: indexTree(tree).entries.map(({ node }) => ({
      id: node.id,
      status: node.status,
      applied: node.appliedAt !== undefined,
      resolutionType: node.resolutionType,
    })),
    product: JSON.stringify(tree.product, (k, v) => (/At$/.test(k) ? undefined : v)),
  };
}

describe("rex update --status on a v2 tree", () => {
  let cliDir: string;
  let mcpDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    cliDir = await project();
    mcpDir = await project();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await rm(cliDir, { recursive: true, force: true });
    await rm(mcpDir, { recursive: true, force: true });
  });

  const output = (): string => logSpy.mock.calls.map((c) => c[0] ?? "").join("\n");

  it("completes the task, its change and applies it, as update_task_status does", async () => {
    await cmdUpdate(cliDir, TASK, { status: "completed", format: "json" });
    const cli = JSON.parse(output());
    const mcpRes = await handleUpdateTaskStatus(await resolveStore(join(mcpDir, ".rex")), mcpDir, { id: TASK, status: "completed" });
    const mcp = JSON.parse(mcpRes.content[0].text);

    expect(cli).toMatchObject({ id: TASK, status: "completed", changeId: CHANGE, changeCompleted: true, applied: true });
    for (const key of ["autoCompleted", "changeId", "changeCompleted", "applied"]) expect(cli[key], key).toEqual(mcp[key]);
    expect(await outcome(cliDir)).toEqual(await outcome(mcpDir));
    expect((await outcome(cliDir)).nodes.find((n) => n.id === CHANGE)).toMatchObject({ status: "completed", applied: true });
  });

  it("writes the other fields of the same call after the completion", async () => {
    await cmdUpdate(cliDir, TASK, { status: "completed", priority: "low" });
    const { tree } = await loadPrdModel(join(cliDir, ".rex"), quiet);
    expect(indexTree(tree).resolve(TASK)).toMatchObject({ status: "completed", priority: "low" });
    expect(output()).toContain("Auto-completed");
    expect(output()).toContain(`Applied change ${CHANGE}`);
  });

  it("resolves a display id to its change, as get_item does", async () => {
    await cmdUpdate(cliDir, "CH-1", { priority: "low" });
    const { tree } = await loadPrdModel(join(cliDir, ".rex"), quiet);
    expect(indexTree(tree).resolve(CHANGE)).toMatchObject({ priority: "low" });
  });

  it("reports a change left unapplied under rex.applyOn review", async () => {
    await writeFile(join(cliDir, ".n-dx.json"), JSON.stringify({ rex: { applyOn: "review" } }));
    await cmdUpdate(cliDir, TASK, { status: "completed", format: "json" });
    expect(JSON.parse(output())).toMatchObject({ changeCompleted: true, applied: false, reason: expect.stringMatching(/"review"/) });
  });

  describe("completes first, writes the other fields only if the completion succeeded", () => {
    const loadNode = async (id: string) => indexTree((await loadPrdModel(join(cliDir, ".rex"), quiet)).tree).resolve(id);

    it("a refused completion writes none of the other fields", async () => {
      // CH-1 still holds its open task, so completing the change is refused.
      await expect(cmdUpdate(cliDir, CHANGE, { status: "completed", title: "Renamed", priority: "low" })).rejects.toThrow(
        /Cannot complete change CH-1: task .* is not completed/,
      );
      expect(await loadNode(CHANGE)).toMatchObject({ title: "Add Apple Pay", status: "pending", priority: "high" });
    });

    it.each([
      ["a self-referencing --blockedBy", { blockedBy: TASK }, /Invalid dependencies/],
      ["an unknown --blockedBy id", { blockedBy: "c0000000-0000-4000-8000-0000000000ff" }, /Invalid dependencies/],
      ["an invalid --run", { run: '{"tier":"not-a-tier"}' }, /Invalid --run/],
    ])("%s leaves the task uncompleted", async (_name, flags, message) => {
      const before = await outcome(cliDir);
      await expect(cmdUpdate(cliDir, TASK, { status: "completed", title: "Renamed", ...flags })).rejects.toThrow(message);
      expect(await outcome(cliDir)).toEqual(before);
      expect(await loadNode(TASK)).toMatchObject({ title: "Wire the button", status: "pending" });
    });

    it("the success path writes the completion and every other field", async () => {
      await cmdUpdate(cliDir, TASK, { status: "completed", title: "Wired", priority: "low", description: "Done" }, { criterion: ["Works"] });
      expect(await loadNode(TASK)).toMatchObject({
        status: "completed",
        title: "Wired",
        priority: "low",
        description: "Done",
        acceptanceCriteria: ["Works"],
      });
      expect(await loadNode(CHANGE)).toMatchObject({ status: "completed" });
    });
  });
});
