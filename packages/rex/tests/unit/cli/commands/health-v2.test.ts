/** `rex health` on a v2 tree: the tree rules run, and the capability-criteria threshold comes from config. */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cmdHealth } from "../../../../src/cli/commands/health.js";
import { withPrdModelTransaction } from "../../../../src/store/prd-model-transaction.js";
import { indexTree } from "../../../../src/schema/v2-rules.js";
import { copyV2Fixture } from "../../../helpers/v2-fixture.js";

const CAPABILITY = "a0000000-0000-4000-8000-000000000002";

let tmp: string;
let rexDir: string;
let out: string[];

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rex-health-v2-"));
  rexDir = await copyV2Fixture(join(tmp, ".rex"), "lf");
  await writeFile(join(rexDir, "config.json"), JSON.stringify({ schema: "rex/v1", project: "t", adapter: "file" }));
  out = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tmp, { recursive: true, force: true });
});

async function setCapabilityCriteria(n: number) {
  await withPrdModelTransaction(rexDir, (model) => {
    const tree = structuredClone(model.tree);
    const capability = indexTree(tree).resolve(CAPABILITY) as unknown as { criteria: unknown[] };
    capability.criteria = Array.from({ length: n }, (_, i) => ({ id: `k${i}`, text: `Capability criterion ${i}` }));
    return { tree, result: undefined };
  });
}

async function run(): Promise<string> {
  out.length = 0;
  await cmdHealth(tmp, {});
  return out.join("\n");
}

describe("rex health on a v2 tree", () => {
  it("warns naming a capability over the default 15 capability criteria", async () => {
    await setCapabilityCriteria(16);
    const text = await run();
    expect(text).toContain("Pay by card");
    expect(text).toContain("criteria-growth");
  });

  it("gives no criteria-growth warning at the threshold", async () => {
    await setCapabilityCriteria(15);
    expect(await run()).not.toContain("criteria-growth");
  });

  it("reads rex.structureHealth.maxCriteriaPerCapability from .n-dx.json", async () => {
    await setCapabilityCriteria(5);
    expect(await run()).not.toContain("criteria-growth");
    await writeFile(join(tmp, ".n-dx.json"), JSON.stringify({ rex: { structureHealth: { maxCriteriaPerCapability: 4 } } }));
    expect(await run()).toContain("criteria-growth");
  });
});
