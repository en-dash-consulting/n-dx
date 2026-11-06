/**
 * A missing PRD folder is reported as missing, not as a v1 project; a real v1
 * tree still gets the v1 message.
 *
 * @see packages/hench/src/cli/commands/prd-folder.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdPlanQueue } from "../../src/cli/commands/plan-queue.js";
import { DEFAULT_HENCH_CONFIG } from "../../src/schema/v1.js";
import { cleanupProjectDir } from "../helpers/index.js";

let root: string;

async function setupHenchConfig(rexDir: string): Promise<void> {
  await mkdir(join(root, ".hench"), { recursive: true });
  await writeFile(join(root, ".hench", "config.json"), JSON.stringify({ ...DEFAULT_HENCH_CONFIG(), rexDir }));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hench-missing-prd-"));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupProjectDir(root);
});

describe("--plan-queue with no PRD folder", () => {
  it("names the folder it looked in and does not call the project v1", async () => {
    await setupHenchConfig("planning");
    const err = await cmdPlanQueue(root, {}).then(
      () => undefined,
      (e: unknown) => e as Error & { suggestion?: string },
    );
    expect(err?.message).toContain("No PRD folder at planning");
    expect(err?.message).not.toContain("v1");
    expect(err?.suggestion).toContain("expects the PRD at");
  });
});

describe("--plan-queue on a real v1 tree", () => {
  it("still says the project is on v1", async () => {
    await setupHenchConfig("planning");
    await mkdir(join(root, "planning"), { recursive: true });
    await writeFile(
      join(root, "planning", "prd.json"),
      JSON.stringify({ schema: "rex/v1", title: "shop", items: [] }),
    );
    await writeFile(
      join(root, "planning", "config.json"),
      JSON.stringify({ schema: "rex/v1", project: "shop", adapter: "file" }),
    );
    await expect(cmdPlanQueue(root, {})).rejects.toThrow(/still on v1/);
  });
});
