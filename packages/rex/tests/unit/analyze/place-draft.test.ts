import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { draftChangePlacement } from "../../../src/analyze/place-draft.js";
import type { PlacementModel } from "../../../src/core/placement.js";
import type { RuleNode, V2Tree } from "../../../src/schema/v2-rules.js";

const node = (fields: Record<string, unknown>): RuleNode => ({ slug: fields.id as string, ...fields }) as RuleNode;
const tree: V2Tree = {
  product: [node({ id: "pay", type: "area", title: "Payments", children: [node({ id: "card", type: "capability", title: "Pay by card" })] })],
  changes: [node({ id: "ch", type: "change", title: "Add wallets to card payment", needsPlacement: true })],
};

describe("draftChangePlacement", () => {
  let dir: string;
  let rexDir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "rex-place-draft-"));
    rexDir = join(dir, ".rex");
    await mkdir(rexDir);
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("asks the model under the default settings", async () => {
    const place = vi.fn<PlacementModel>(async () => "card");
    const d = await draftChangePlacement(tree, "ch", { rexDir, projectDir: dir, place });
    expect(place).toHaveBeenCalledOnce();
    expect(d.pick).toBe("card");
  });

  it("skips the text model when rex.placement.models is jev, saying so", async () => {
    await writeFile(join(dir, ".n-dx.json"), JSON.stringify({ rex: { placement: { models: "jev" } } }));
    const place = vi.fn<PlacementModel>(async () => "card");
    const d = await draftChangePlacement(tree, "ch", { rexDir, projectDir: dir, place });
    expect(place).not.toHaveBeenCalled();
    expect(d.pick).toBeUndefined();
    expect(d.shortlist[0]).toMatchObject({ target: "card" });
    expect(d.warnings).toEqual([expect.stringContaining("text model is off")]);
  });
});
