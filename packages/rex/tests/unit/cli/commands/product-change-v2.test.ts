/**
 * `rex product`, `rex change` and `rex add` on a v2 tree, and the v1 refusals.
 * Capability criteria (--capability-criterion) and acceptance criteria
 * (--criterion) never stand in for each other.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cmdProduct } from "../../../../src/cli/commands/product.js";
import { cmdChange } from "../../../../src/cli/commands/change.js";
import { cmdAddChange, cmdAddChangesFromDescriptions, titleFrom } from "../../../../src/cli/commands/add-change.js";
import { getCommandHelp } from "../../../../src/cli/help.js";
import { loadPrdModel } from "../../../../src/store/prd-model-reader.js";
import { indexTree, type RuleNode } from "../../../../src/schema/v2-rules.js";
import { ensureRexDir, createStore } from "../../../../src/store/index.js";
import { SCHEMA_VERSION } from "../../../../src/schema/index.js";
import { copyV2Fixture } from "../../../helpers/v2-fixture.js";

const CAPABILITY = "a0000000-0000-4000-8000-000000000002";
const CHANGE = "c0000000-0000-4000-8000-000000000001";

let tmp: string;
let rexDir: string;
let out: string[];

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rex-v2-cli-"));
  rexDir = await copyV2Fixture(join(tmp, ".rex"), "lf");
  await writeFile(join(rexDir, "config.json"), JSON.stringify({ schema: "rex/v1", project: "t", adapter: "file" }));
  out = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tmp, { recursive: true, force: true });
});

const text = () => out.join("\n");
const node = async (ref: string) => indexTree((await loadPrdModel(rexDir)).tree).resolve(ref) as RuleNode & Record<string, any>;
const changes = async () => (await loadPrdModel(rexDir)).tree.changes;

async function addInbox(title: string): Promise<string> {
  out.length = 0;
  await cmdAddChange(tmp, undefined, { title, format: "json" });
  return JSON.parse(text()).id;
}

describe("rex product show", () => {
  it("lists areas and capabilities with computed status", async () => {
    await cmdProduct(tmp, "show", undefined, {});
    expect(text()).toContain("Fixture shop");
    expect(text()).toMatch(/A1 Checkout \(area\)/);
    expect(text()).toMatch(/A1\.1 Pay by card \(capability\) — changing/);
  });

  it("shows one capability with its capability criteria and changes", async () => {
    await cmdProduct(tmp, "show", "A1.1", {});
    expect(text()).toContain("Capability criteria:");
    expect(text()).toContain("c1: A valid card is charged once");
    expect(text()).toMatch(/CH-1 Add Apple Pay \(amends, in_progress\)/);
  });

  it("prints JSON with --format=json", async () => {
    await cmdProduct(tmp, "show", undefined, { format: "json" });
    expect(JSON.parse(text()).areas[0].children[0]).toMatchObject({ id: CAPABILITY, status: "changing" });
  });
});

describe("rex product edit", () => {
  beforeEach(async () => {
    // Applying CH-1 makes the capability met, so a spec edit revises it.
    await cmdChange(tmp, "apply", "CH-1", {});
    out.length = 0;
  });

  it("adds a capability criterion, revising the capability and drafting a change", async () => {
    await cmdProduct(tmp, "edit", "A1.1", {}, { "capability-criterion": ["c9: A refund reaches the card"] });
    expect(text()).toMatch(/Edited A1\.1 Pay by card: it now reads revised/);
    expect(text()).toMatch(/Drafted change: .*Build the revised Pay by card \(Inbox, needs placement\)/);
    expect((await node(CAPABILITY)).criteria.map((c: { id: string }) => c.id)).toEqual(["c1", "c2", "c3", "c9"]);
    expect((await changes()).some((c) => c.source === "product-edit")).toBe(true);
  });

  it("replaces and removes capability criteria by id", async () => {
    await cmdProduct(tmp, "edit", "A1.1", {}, { "capability-criterion": ["c1: Charged exactly once"], "remove-capability-criterion": ["c2"] });
    expect((await node(CAPABILITY)).criteria).toEqual([{ id: "c1", text: "Charged exactly once" }, expect.objectContaining({ id: "c3" })]);
  });

  it("keeps the capability met on --editorial, drafting nothing", async () => {
    const before = (await changes()).length;
    await cmdProduct(tmp, "edit", "A1.1", { statement: "A shopper can pay for a basket by card.", editorial: "true" });
    expect(text()).toMatch(/\(editorial\): it stays met/);
    expect((await changes()).length).toBe(before);
    expect((await node(CAPABILITY)).statement).toBe("A shopper can pay for a basket by card.");
  });

  it("refuses --criterion, naming capability criteria and the flag to use", async () => {
    await expect(cmdProduct(tmp, "edit", "A1.1", {}, { criterion: ["x"] })).rejects.toThrow(/acceptance criteria.*capability criteria/);
  });

  it("refuses a malformed capability criterion and an edit with nothing to change", async () => {
    await expect(cmdProduct(tmp, "edit", "A1.1", {}, { "capability-criterion": ["no id here"] })).rejects.toThrow(/is not "<id>: <text>"/);
    await expect(cmdProduct(tmp, "edit", "A1.1", {})).rejects.toThrow(/Nothing to edit/);
    await expect(cmdProduct(tmp, "edit", "A1.1", {}, { "remove-capability-criterion": ["c42"] })).rejects.toThrow(/capability criteria of A1\.1: criterion c42 to remove does not exist/);
    await expect(cmdProduct(tmp, "edit", "A1", { statement: "x" })).rejects.toThrow(/not a live capability or constraint/);
  });
});

describe("rex change place", () => {
  it("prints the shortlist without writing when no target is given", async () => {
    const id = await addInbox("Support refunds when paying by card");
    out.length = 0;
    await cmdChange(tmp, "place", id, {});
    expect(text()).toMatch(/A1\.1 Pay by card \(amends\)/);
    expect(text()).toContain(`rex change place ${id} --target=A1.1 --relation=amends`);
    expect((await node(id)).needsPlacement).toBe(true);
  });

  it("records a touches placement and clears needsPlacement", async () => {
    const id = await addInbox("Tidy the card form");
    out.length = 0;
    await cmdChange(tmp, "place", id, { target: "A1.1", relation: "touches" });
    expect(text()).toMatch(/Placed .*Tidy the card form: touches A1\.1 Pay by card/);
    const placed = await node(id);
    expect(placed.touches).toEqual([CAPABILITY]);
    expect(placed.needsPlacement).toBeUndefined();
  });

  it("turns capability-criterion flags into an add or replace delta against the target", async () => {
    const id = await addInbox("Refunds by card");
    await cmdChange(tmp, "place", id, { target: "A1.1", relation: "amends" }, {
      "capability-criterion": ["c2: A declined card names the reason", "c9: A refund reaches the card"],
    });
    expect((await node(id)).amends[0].criteria).toEqual({
      add: [{ id: "c9", text: "A refund reaches the card" }],
      replace: [{ id: "c2", text: "A declined card names the reason" }],
    });
  });

  it("refuses --criterion and amendment content without --relation=amends", async () => {
    const id = await addInbox("Refunds by card");
    await expect(cmdChange(tmp, "place", id, { target: "A1.1" }, { criterion: ["x"] })).rejects.toThrow(/acceptance criteria/);
    await expect(cmdChange(tmp, "place", id, { target: "A1.1", relation: "touches", proposed: "x" })).rejects.toThrow(/--relation=amends/);
    await expect(cmdChange(tmp, "place", id, { relation: "touches" })).rejects.toThrow(/pass --target/);
  });
});

describe("rex change apply", () => {
  it("applies the change's amendments and names them", async () => {
    await cmdChange(tmp, "apply", "CH-1", {});
    expect(text()).toMatch(/Applied CH-1 Add Apple Pay\.\n {2}modified A1\.1 Pay by card/);
    expect((await node(CHANGE)).appliedAt).toEqual(expect.any(String));
  });

  it("names the placement flags when a modified amendment has nothing to modify", async () => {
    const id = await addInbox("Refunds by card");
    await cmdChange(tmp, "place", id, { target: "A1.1", relation: "amends" });
    const err = await cmdChange(tmp, "apply", id, {}).catch((e: Error & { suggestion?: string }) => e);
    expect((err as Error).message).toMatch(/nothing to modify/);
    expect((err as { suggestion?: string }).suggestion).toMatch(/--capability-criterion/);
  });
});

describe("rex add on a v2 tree", () => {
  it("creates a change in the Inbox and names its suggested placement", async () => {
    await cmdAddChange(tmp, undefined, { title: "Support refunds when paying by card" }, { criterion: ["A refund reaches the card"] });
    expect(text()).toContain("Created change: Support refunds when paying by card");
    expect(text()).toContain("Placement: Inbox (needs placement)");
    expect(text()).toMatch(/A1\.1 Pay by card \(amends\)/);
    const created = (await changes()).find((c) => c.title === "Support refunds when paying by card")!;
    expect(created).toMatchObject({ needsPlacement: true, acceptanceCriteria: ["A refund reaches the card"] });
  });

  it("adds a task under a change", async () => {
    await cmdAddChange(tmp, "task", { title: "Write the refund call", parent: "CH-1" });
    expect(text()).toContain("Created task: Write the refund call");
    expect(text()).not.toContain("Placement");
  });

  it("refuses levels, --level and capability criteria", async () => {
    await expect(cmdAddChange(tmp, "epic", { title: "x" })).rejects.toThrow(/type, not a level/);
    await expect(cmdAddChange(tmp, undefined, { title: "x", level: "task" })).rejects.toThrow(/type, not a level/);
    await expect(cmdAddChange(tmp, undefined, { title: "x" }, { "capability-criterion": ["c1: x"] })).rejects.toThrow(/capability criteria/);
  });

  it("makes one change per description, titled from its first line", async () => {
    await cmdAddChangesFromDescriptions(tmp, ["# Refunds\n\nShoppers want card refunds.", "Dark mode"], {});
    const titles = (await changes()).map((c) => c.title);
    expect(titles).toEqual(expect.arrayContaining(["Refunds", "Dark mode"]));
    expect((await changes()).find((c) => c.title === "Refunds")!.intent).toContain("Shoppers want card refunds.");
    expect(text().match(/Created change:/g)).toHaveLength(2);
  });

  it("previews without writing under --format=json without --accept (the dashboard's Quick Add)", async () => {
    const before = (await changes()).length;
    await cmdAddChangesFromDescriptions(tmp, ["Support refunds when paying by card"], { format: "json", fast: "true" });
    const body = JSON.parse(text());
    expect(body).toMatchObject({ preview: true, proposals: [], changes: [{ title: "Support refunds when paying by card", placement: { relation: "amends" } }] });
    expect((await changes()).length).toBe(before);

    out.length = 0;
    await cmdAddChangesFromDescriptions(tmp, ["Support refunds when paying by card"], { format: "json", accept: "true" });
    expect(JSON.parse(text())).toMatchObject({ title: "Support refunds when paying by card", needsPlacement: true });
    expect((await changes()).length).toBe(before + 1);
  });

  it("titleFrom cuts a long first line at a word", () => {
    const long = "word ".repeat(30).trim();
    const title = titleFrom(long);
    expect(title.length).toBeLessThanOrEqual(81);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("on a v1 tree", () => {
  beforeEach(async () => {
    await rm(rexDir, { recursive: true, force: true });
    await ensureRexDir(rexDir);
    const store = createStore("file", rexDir);
    await store.saveDocument({ schema: SCHEMA_VERSION, title: "v1", items: [] });
  });

  it("product and change refuse, naming the v1 layout", async () => {
    await expect(cmdProduct(tmp, "show", undefined, {})).rejects.toThrow(/v1 layout/);
    await expect(cmdProduct(tmp, "edit", "x", { statement: "y" })).rejects.toThrow(/v1 layout/);
    await expect(cmdChange(tmp, "place", "x", {})).rejects.toThrow(/v1 layout/);
    await expect(cmdChange(tmp, "apply", "x", {})).rejects.toThrow(/v1 layout/);
  });
});

describe("help", () => {
  it("documents every verb and says which criteria flag is which", () => {
    const product = getCommandHelp("product")!;
    const change = getCommandHelp("change")!;
    const add = getCommandHelp("add")!;
    expect(product).toMatch(/rex product show/);
    expect(product).toMatch(/rex product edit/);
    expect(change).toMatch(/rex change place/);
    expect(change).toMatch(/rex change apply/);
    for (const help of [product, change]) {
      expect(help).toContain("--capability-criterion");
      expect(help).toMatch(/not .*acceptance criteria|They are not acceptance criteria/s);
    }
    expect(add).toMatch(/--criterion.*Acceptance criterion \(done when\)/);
    expect(add).toContain("capability criteria");
    for (const help of [product, change, add]) expect(help.replace(/\s+/g, " ")).not.toMatch(/(?<!capability |acceptance |Capability |Acceptance )\bcriteria\b/);
  });
});
