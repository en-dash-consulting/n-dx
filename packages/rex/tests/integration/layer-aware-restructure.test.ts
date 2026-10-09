/**
 * Integration: `rex reshape`, `rex reorganize` and `rex prune` on a v2 tree.
 *
 * The change layer is restructured as a v1 tree is. The product layer never
 * is: reshape drafts a change carrying removed and added amendments,
 * reorganize only reports, and prune leaves it alone. No file under
 * product/ is written by any of them.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { copyV2Fixture } from "../helpers/v2-fixture.js";
import type { ReshapeProposal } from "../../src/core/reshape.js";
import type { PRDItem } from "../../src/schema/index.js";

const { mockReasonForReshape } = vi.hoisted(() => ({
  mockReasonForReshape: vi.fn(async (_items: PRDItem[], _options?: unknown) => ({
    proposals: [] as ReshapeProposal[],
    tokenUsage: { calls: 1, inputTokens: 1, outputTokens: 1 },
  })),
}));

vi.mock("@n-dx/llm-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@n-dx/llm-client")>()),
  printVendorModelHeader: vi.fn(),
}));
vi.mock("../../src/analyze/reshape-reason.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/analyze/reshape-reason.js")>()),
  reasonForReshape: mockReasonForReshape,
}));
vi.mock("../../src/cli/commands/token-format.js", () => ({
  preflightBudgetCheck: vi.fn().mockResolvedValue(null),
  formatBudgetWarnings: vi.fn().mockReturnValue([]),
}));

import { cmdReshape } from "../../src/cli/commands/reshape.js";
import { cmdReorganize } from "../../src/cli/commands/reorganize.js";
import { cmdPrune } from "../../src/cli/commands/prune.js";
import { loadPrdModel } from "../../src/store/prd-model-reader.js";
import { applyAmendments } from "../../src/core/apply-amendments.js";
import { PRODUCT_RESHAPE_TITLE } from "../../src/core/product-reshape.js";

const AREA = "a0000000-0000-4000-8000-000000000001";
const PAY_BY_CARD = "a0000000-0000-4000-8000-000000000002";
const GIFT_CARDS = "a0000000-0000-4000-8000-000000000003";
const DELIVERY = "a0000000-0000-4000-8000-000000000004";
const APPLE_PAY = "c0000000-0000-4000-8000-000000000001";
const DONE_CHANGE = "c0000000-0000-4000-8000-000000000003";

let tmp: string;
let rexDir: string;
let output: string[];

/** Every file under `dir`, relative path to content. */
async function files(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    out.set(relative(dir, path), await readFile(path, "utf-8"));
  }
  return out;
}

const productFiles = () => files(join(rexDir, "product"));

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rex-layer-aware-"));
  rexDir = join(tmp, ".rex");
  await copyV2Fixture(rexDir, "lf");
  await writeFile(join(rexDir, "config.json"), JSON.stringify({ schema: "rex/v1", project: "shop", adapter: "file" }));
  // A second capability in Checkout, and a Delivery area to move it to.
  await writeFile(
    join(rexDir, "product", "checkout", "gift-cards.md"),
    `---\nid: "${GIFT_CARDS}"\ntype: "capability"\ntitle: "Gift cards"\nslug: "gift-cards"\ndisplayId: "A1.2"\nstatement: "A shopper can pay with a gift card."\ncriteria: [{"id":"c1","text":"The balance goes down"}]\n---\n`,
  );
  await writeFile(
    join(rexDir, "product", "delivery.md"),
    `---\nid: "${DELIVERY}"\ntype: "area"\ntitle: "Delivery"\nslug: "delivery"\ndisplayId: "A2"\n---\n`,
  );
  // A finished change: prune's candidate on the change layer.
  const done = join(rexDir, "changes", "tidy-the-receipt");
  await mkdir(done);
  await writeFile(
    join(done, "index.md"),
    `---\nid: "${DONE_CHANGE}"\ntype: "change"\ntitle: "Tidy the receipt"\nslug: "tidy-the-receipt"\ntouches: ["${PAY_BY_CARD}"]\n---\n`,
  );
  await writeFile(join(done, "state.yaml"), `schema: "rex/v2"\nitems:\n  "${DONE_CHANGE}":\n    status: "completed"\n    completedAt: "2026-10-02T09:00:00.000Z"\n`);

  output = [];
  const capture = (...args: unknown[]) => void output.push(args.map(String).join(" "));
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  mockReasonForReshape.mockReset();
  mockReasonForReshape.mockResolvedValue({ proposals: [], tokenUsage: { calls: 1, inputTokens: 1, outputTokens: 1 } });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tmp, { recursive: true, force: true });
});

/** Proposals for the product layer only: the mock answers [] for the change layer. */
function proposeOnProduct(proposals: ReshapeProposal[]): void {
  mockReasonForReshape.mockImplementation(async (items: PRDItem[]) => ({
    proposals: items.some((i) => (i as PRDItem & { type?: string }).type === "area") ? proposals : [],
    tokenUsage: { calls: 1, inputTokens: 1, outputTokens: 1 },
  }));
}

describe("rex reshape on a v2 tree", () => {
  it("drafts a change with removed and added amendments for product proposals, and moves no product file", async () => {
    proposeOnProduct([
      { id: "p1", action: { action: "reparent", itemId: GIFT_CARDS, newParentId: DELIVERY, reason: "Gift cards are redeemed at delivery" } },
    ]);
    const before = await productFiles();

    await cmdReshape(tmp, { accept: "true" });

    expect(await productFiles()).toEqual(before);
    const { tree } = await loadPrdModel(rexDir);
    const drafted = tree.changes.find((c) => c.title === PRODUCT_RESHAPE_TITLE);
    expect(drafted).toBeDefined();
    const amends = (drafted as { amends?: Array<{ delta: string; target: string; under?: string; title?: string }> }).amends!;
    expect(amends.map((a) => a.delta)).toEqual(["removed", "added"]);
    expect(amends[0].target).toBe(GIFT_CARDS);
    expect(amends[1]).toMatchObject({ under: DELIVERY, title: "Gift cards" });

    // The draft is one a steward can apply: the move happens then, not now.
    const applied = applyAmendments(tree, drafted!.id, { appliedAt: "2026-10-09T00:00:00.000Z", now: new Date("2026-10-09T00:00:00Z") });
    expect(applied.applied.map((a) => a.delta)).toEqual(["removed", "added"]);
  });

  it("drafts nothing on --dry-run", async () => {
    proposeOnProduct([{ id: "p1", action: { action: "obsolete", itemId: GIFT_CARDS, reason: "No longer sold" } }]);
    const before = await files(rexDir);

    await cmdReshape(tmp, { "dry-run": "true" });

    expect(await files(rexDir)).toEqual(before);
    expect(output.join("\n")).toMatch(/Product layer: 1 proposal/);
  });

  it("names a proposal no amendment can express and drafts the rest", async () => {
    proposeOnProduct([
      { id: "p1", action: { action: "reparent", itemId: AREA, newParentId: DELIVERY, reason: "Nest checkout" } },
      { id: "p2", action: { action: "obsolete", itemId: GIFT_CARDS, reason: "No longer sold" } },
    ]);

    await cmdReshape(tmp, { accept: "true" });

    expect(output.join("\n")).toMatch(/Not drafted: proposal 1: an area cannot be moved by an amendment/);
    const { tree } = await loadPrdModel(rexDir);
    const drafted = tree.changes.find((c) => c.title === PRODUCT_RESHAPE_TITLE) as { amends?: Array<{ delta: string; target: string }> };
    expect(drafted.amends).toEqual([expect.objectContaining({ delta: "removed", target: GIFT_CARDS })]);
  });

  it("restructures the change layer as today, outside product/", async () => {
    mockReasonForReshape.mockImplementation(async (items: PRDItem[]) => ({
      proposals: items.some((i) => i.id === APPLE_PAY)
        ? [{ id: "c1", action: { action: "obsolete", itemId: APPLE_PAY, reason: "Wallets wait a release" } } as ReshapeProposal]
        : [],
      tokenUsage: { calls: 1, inputTokens: 1, outputTokens: 1 },
    }));
    const before = await productFiles();
    const changesBefore = await files(join(rexDir, "changes"));

    await cmdReshape(tmp, { accept: "true" });

    expect(await productFiles()).toEqual(before);
    // Only the status moved, into state.yaml: the projection adds nothing to intent.
    // (The hand-written tidy-the-receipt is left out: the writer canonicalizes its frontmatter.)
    const changesAfter = await files(join(rexDir, "changes"));
    const changed = [...changesAfter.keys()].filter((k) => k.startsWith("add-apple-pay") && changesAfter.get(k) !== changesBefore.get(k));
    expect(changed).toEqual([join("add-apple-pay", "state.yaml")]);
    const { tree } = await loadPrdModel(rexDir);
    // obsolete defers the item, as it does on a v1 tree; no change is drafted.
    expect(tree.changes.map((c) => [c.id, c.status])).toEqual([
      [APPLE_PAY, "deferred"],
      [DONE_CHANGE, "completed"],
    ]);
  });
});

describe("rex reorganize on a v2 tree", () => {
  it("reports the product layer and never writes under product/", async () => {
    const before = await productFiles();

    await cmdReorganize(tmp, { accept: "all", fast: "true", format: "json" });

    expect(await productFiles()).toEqual(before);
    const json = JSON.parse(output.find((line) => line.trimStart().startsWith("{"))!);
    expect(json.product).toMatchObject({ proposals: expect.any(Array), stats: expect.any(Object) });
  });
});

describe("rex prune on a v2 tree", () => {
  it("prunes the change layer and never writes under product/", async () => {
    // Pay by card is completed: on a v1 tree it would be pruned.
    const before = await productFiles();

    await cmdPrune(tmp, { yes: "true", "no-consolidate": "true" });

    expect(await productFiles()).toEqual(before);
    const { tree } = await loadPrdModel(rexDir);
    expect(tree.changes.map((c) => c.id)).toEqual([APPLE_PAY]);
    expect(tree.product[0].children?.map((c) => c.id)).toContain(PAY_BY_CARD);
    expect(output.join("\n")).toMatch(/The product layer is not pruned/);
  });
});
