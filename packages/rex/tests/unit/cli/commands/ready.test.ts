import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { CLIError } from "../../../../src/cli/errors.js";
import { cmdReady } from "../../../../src/cli/commands/ready.js";
import { resolveStore } from "../../../../src/store/index.js";
import type { PRDStore } from "../../../../src/store/index.js";

describe("cmdReady", () => {
  let tmp: string;
  let store: PRDStore;
  const qualifyingId = "qualifying-item-1";
  const noRequirementId = "no-requirement-item-1";

  // Fixtures are written through the real store (addItem -> the production
  // serializer), not the hand-rolled test-support writer — that helper does
  // not encode array-of-object fields (like `requirements`) the way the real
  // folder-tree serializer does, so it can't stand in for it here.
  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), "rex-ready-test-"));
    mkdirSync(join(tmp, ".rex"));
    // FileStore's legacy-source fallback (used until the folder tree exists)
    // expects prd.json to be present — an empty one is what `rex init`
    // creates. Without it, the very first `addItem` below hits an ENOENT
    // reading it.
    writeFileSync(
      join(tmp, ".rex", "prd.json"),
      JSON.stringify({ schema: "rex/v1", title: "test", items: [] }),
    );
    store = await resolveStore(join(tmp, ".rex"));
    await store.addItem({
      id: qualifyingId,
      title: "Qualifying item",
      level: "epic",
      status: "pending",
      requirements: [
        {
          id: "req-1",
          title: "CI check",
          category: "technical",
          validationType: "automated",
          acceptanceCriteria: ["Passes CI"],
        },
      ],
    });
    await store.addItem({
      id: noRequirementId,
      title: "No requirement item",
      level: "epic",
      status: "pending",
    });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true });
  });

  it("marks a qualifying item ready and leaves a non-candidate untouched", async () => {
    await cmdReady(tmp, {});

    const doc = await store.loadDocument();
    const qualifying = doc.items.find((i) => i.id === qualifyingId);
    const noRequirement = doc.items.find((i) => i.id === noRequirementId);
    expect(qualifying?.ready).toBe(true);
    expect(noRequirement?.ready).toBeUndefined();
  });

  it("is idempotent across repeated runs", async () => {
    await cmdReady(tmp, {});
    await cmdReady(tmp, {});

    const doc = await store.loadDocument();
    expect(doc.items.find((i) => i.id === qualifyingId)?.ready).toBe(true);
  });

  it("unmarks a previously-ready item once it stops qualifying", async () => {
    await cmdReady(tmp, {});
    let doc = await store.loadDocument();
    expect(doc.items.find((i) => i.id === qualifyingId)?.ready).toBe(true);

    // Simulate the item becoming blocked between runs, then re-evaluate.
    await store.updateItem(qualifyingId, { status: "blocked" });
    await cmdReady(tmp, {});

    doc = await store.loadDocument();
    expect(doc.items.find((i) => i.id === qualifyingId)?.ready).toBeUndefined();
  });

  it("evaluates a single item via --item without touching the rest of the tree", async () => {
    await cmdReady(tmp, { item: qualifyingId });

    const doc = await store.loadDocument();
    expect(doc.items.find((i) => i.id === qualifyingId)?.ready).toBe(true);
    expect(doc.items.find((i) => i.id === noRequirementId)?.ready).toBeUndefined();
  });

  it("throws CLIError when --item does not resolve to an existing item", async () => {
    await expect(cmdReady(tmp, { item: "nonexistent" })).rejects.toThrow(CLIError);
    await expect(cmdReady(tmp, { item: "nonexistent" })).rejects.toThrow(/not found/);
  });

  it("refuses an empty --item instead of falling through to the whole tree", async () => {
    await expect(cmdReady(tmp, { item: "" })).rejects.toThrow(/--item needs an item id/);
  });
});
