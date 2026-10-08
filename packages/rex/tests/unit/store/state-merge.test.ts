/**
 * Three-way `state.yaml` merge: rows by id, recomputed `metAt` and `status`.
 *
 * @see packages/rex/src/store/state-merge.ts
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ItemState } from "../../../src/schema/v2.js";
import { specHash } from "../../../src/schema/v2-rules.js";
import { mergeStateYaml, readFolderSpecs } from "../../../src/store/state-merge.js";
import { parseStateYaml, serializeStateYaml, type ProductSpec } from "../../../src/store/state-writer.js";

const PARENT = "p0000000-0000-4000-8000-000000000000";
const A = "a0000000-0000-4000-8000-000000000001";
const B = "b0000000-0000-4000-8000-000000000002";
const C = "c0000000-0000-4000-8000-000000000003";

/** Canonical `state.yaml` text for these rows. */
function state(items: Record<string, ItemState>): string {
  return serializeStateYaml({ schema: "rex/v2", items });
}

function rows(text: string): Record<string, ItemState> {
  return parseStateYaml(text).items;
}

const BASE_SPEC: ProductSpec = { statement: "A shopper can pay by card.", criteria: [{ id: "c1", text: "Charged once" }] };
const OURS_SPEC: ProductSpec = { statement: "A shopper can pay by card or wallet.", criteria: [{ id: "c1", text: "Charged once" }] };
const THEIRS_SPEC: ProductSpec = { statement: "A shopper can pay by any card.", criteria: [{ id: "c1", text: "Charged once" }] };

describe("rows merge by id", () => {
  it("merges concurrent child adds cleanly", () => {
    const base = state({ [PARENT]: { status: "in_progress" } });
    const ours = state({ [PARENT]: { status: "in_progress" }, [A]: { status: "pending", lastModified: "2026-10-01T00:00:00Z" } });
    const theirs = state({ [PARENT]: { status: "in_progress" }, [B]: { status: "in_progress", lastModified: "2026-10-02T00:00:00Z" } });

    const { merged, conflicts } = mergeStateYaml(base, ours, theirs);

    expect(conflicts).toEqual([]);
    expect(merged).toBe(
      state({
        [PARENT]: { status: "in_progress" },
        [A]: { status: "pending", lastModified: "2026-10-01T00:00:00Z" },
        [B]: { status: "in_progress", lastModified: "2026-10-02T00:00:00Z" },
      }),
    );
  });

  it("merges a child added on each side when the folder had no state.yaml", () => {
    const { merged, conflicts } = mergeStateYaml("", state({ [A]: { status: "pending" } }), state({ [B]: { status: "pending" } }));
    expect(conflicts).toEqual([]);
    expect(Object.keys(rows(merged))).toEqual([A, B]);
  });

  it("merges completions of different tasks in one folder", () => {
    const base = state({ [A]: { status: "in_progress" }, [B]: { status: "in_progress" } });
    const ours = state({ [A]: { status: "completed", completedAt: "2026-10-01T00:00:00Z" }, [B]: { status: "in_progress" } });
    const theirs = state({ [A]: { status: "in_progress" }, [B]: { status: "completed", completedAt: "2026-10-02T00:00:00Z" } });

    const { merged, conflicts } = mergeStateYaml(base, ours, theirs);

    expect(conflicts).toEqual([]);
    expect(rows(merged)).toEqual({
      [A]: { status: "completed", completedAt: "2026-10-01T00:00:00Z" },
      [B]: { status: "completed", completedAt: "2026-10-02T00:00:00Z" },
    });
  });

  it("merges different fields changed on each side of one row", () => {
    const base = state({ [A]: { status: "pending" } });
    const ours = state({ [A]: { status: "in_progress", startedAt: "2026-10-01T00:00:00Z" } });
    const theirs = state({ [A]: { status: "pending", assignee: "Sam <sam@example.com>" } });

    const { merged, conflicts } = mergeStateYaml(base, ours, theirs);

    expect(conflicts).toEqual([]);
    expect(rows(merged)[A]).toEqual({ status: "in_progress", startedAt: "2026-10-01T00:00:00Z", assignee: "Sam <sam@example.com>" });
  });

  it("drops a row removed on one side and unchanged on the other", () => {
    const base = state({ [A]: { status: "pending" }, [B]: { status: "pending" } });
    const { merged, conflicts } = mergeStateYaml(base, state({ [B]: { status: "pending" } }), base);
    expect(conflicts).toEqual([]);
    expect(Object.keys(rows(merged))).toEqual([B]);
  });

  it("keeps a row removed on one side and modified on the other", () => {
    const base = state({ [A]: { status: "pending" }, [B]: { status: "pending" } });
    const theirs = state({ [A]: { status: "completed", completedAt: "2026-10-01T00:00:00Z" }, [B]: { status: "pending" } });
    const { merged, conflicts } = mergeStateYaml(base, state({ [B]: { status: "pending" } }), theirs);
    expect(conflicts).toEqual([]);
    expect(rows(merged)[A]).toEqual({ status: "completed", completedAt: "2026-10-01T00:00:00Z" });
  });

  it("keeps keys a newer build added, from either side", () => {
    const base = state({ [A]: { status: "pending" } });
    const ours = state({ [A]: { status: "pending", futureField: { n: 1 } } });
    const theirs = state({ [A]: { status: "pending" }, [C]: { status: "pending" } }).replace("items:", "futureTop: true\nitems:");

    const { merged, conflicts } = mergeStateYaml(base, ours, theirs);

    expect(conflicts).toEqual([]);
    const file = parseStateYaml(merged);
    expect(file.futureTop).toBe(true);
    expect(file.items[A]).toEqual({ status: "pending", futureField: { n: 1 } });
  });
});

describe("metAt is recomputed from the spec, not picked", () => {
  const base = state({ [A]: { status: "completed", metAt: specHash(BASE_SPEC) } });
  const ours = state({ [A]: { status: "completed", metAt: specHash(OURS_SPEC), lastModified: "2026-10-03T00:00:00Z" } });
  const theirs = state({
    [A]: { status: "completed", metAt: specHash(THEIRS_SPEC), revisedAt: "2026-10-01T00:00:00Z", lastModified: "2026-10-02T00:00:00Z" },
  });

  it("takes the hash of the current spec, even from the side with the older lastModified", () => {
    const { merged, conflicts } = mergeStateYaml(base, ours, theirs, { specs: new Map([[A, THEIRS_SPEC]]) });

    expect(conflicts).toEqual([]);
    expect(rows(merged)[A]).toEqual({ status: "completed", metAt: specHash(THEIRS_SPEC), lastModified: "2026-10-03T00:00:00Z" });
  });

  it("clears revisedAt when the recomputed metAt matches the spec", () => {
    const { merged } = mergeStateYaml(base, ours, theirs, { specs: new Map([[A, OURS_SPEC]]) });
    expect(rows(merged)[A].metAt).toBe(specHash(OURS_SPEC));
    expect(rows(merged)[A]).not.toHaveProperty("revisedAt");
  });

  it("conflicts when neither side's hash matches the spec", () => {
    const { merged, conflicts } = mergeStateYaml(base, ours, theirs, { specs: new Map([[A, BASE_SPEC]]) });

    expect(conflicts).toEqual([`${A}.metAt`]);
    expect(merged).toContain(
      ["<<<<<<< ours", `    metAt: "${specHash(OURS_SPEC)}"`, "=======", `    metAt: "${specHash(THEIRS_SPEC)}"`, ">>>>>>> theirs"].join("\n"),
    );
  });

  it("conflicts when the node's spec is unknown", () => {
    expect(mergeStateYaml(base, ours, theirs).conflicts).toEqual([`${A}.metAt`]);
  });
});

describe("status is recomputed from the merged row", () => {
  it("reads completed when the merged row records a completion", () => {
    const base = state({ [A]: { status: "in_progress", lastModified: "2026-10-01T00:00:00Z" } });
    const ours = state({ [A]: { status: "completed", completedAt: "2026-10-02T00:00:00Z", lastModified: "2026-10-02T00:00:00Z" } });
    const theirs = state({ [A]: { status: "failing", failureReason: "flaky", lastModified: "2026-10-03T00:00:00Z" } });

    const { merged, conflicts } = mergeStateYaml(base, ours, theirs);

    expect(conflicts).toEqual([]);
    expect(rows(merged)[A]).toEqual({
      status: "completed",
      completedAt: "2026-10-02T00:00:00Z",
      failureReason: "flaky",
      lastModified: "2026-10-03T00:00:00Z",
    });
  });

  it("conflicts when no completion decides it", () => {
    const base = state({ [A]: { status: "pending" } });
    const ours = state({ [A]: { status: "deferred", lastModified: "2026-10-02T00:00:00Z" } });
    const theirs = state({ [A]: { status: "blocked", lastModified: "2026-10-03T00:00:00Z" } });

    const { merged, conflicts } = mergeStateYaml(base, ours, theirs);

    expect(conflicts).toEqual([`${A}.status`]);
    expect(merged).toBe(
      [
        'schema: "rex/v2"',
        "items:",
        `  "${A}":`,
        "<<<<<<< ours",
        '    status: "deferred"',
        "=======",
        '    status: "blocked"',
        ">>>>>>> theirs",
        '    lastModified: "2026-10-03T00:00:00Z"',
        "",
      ].join("\n"),
    );
  });

  it("resolves the same task completed on both sides by stamps", () => {
    const base = state({ [A]: { status: "in_progress", startedAt: "2026-10-01T00:00:00Z" } });
    const ours = state({
      [A]: { status: "completed", startedAt: "2026-09-30T00:00:00Z", completedAt: "2026-10-02T00:00:00Z", lastModifiedBy: "Ours", lastModified: "2026-10-02T00:00:00Z" },
    });
    const theirs = state({
      [A]: { status: "completed", startedAt: "2026-10-01T00:00:00Z", completedAt: "2026-10-03T00:00:00Z", lastModifiedBy: "Theirs", lastModified: "2026-10-03T00:00:00Z" },
    });

    const { merged, conflicts } = mergeStateYaml(base, ours, theirs);

    expect(conflicts).toEqual([]);
    expect(rows(merged)[A]).toEqual({
      status: "completed",
      startedAt: "2026-09-30T00:00:00Z",
      completedAt: "2026-10-03T00:00:00Z",
      lastModified: "2026-10-03T00:00:00Z",
      lastModifiedBy: "Theirs",
    });
  });

  it("conflicts on other fields when lastModified cannot order the sides", () => {
    const base = state({ [A]: { status: "failing", failureReason: "x" } });
    const ours = state({ [A]: { status: "failing", failureReason: "y" } });
    const theirs = state({ [A]: { status: "failing", failureReason: "z" } });
    expect(mergeStateYaml(base, ours, theirs).conflicts).toEqual([`${A}.failureReason`]);
  });
});

describe("unparseable sides", () => {
  const good = state({ [A]: { status: "pending" } });
  const broken = "items:\n  bad indentation\n";

  it("takes the other side when the broken side is unchanged from the ancestor", () => {
    expect(mergeStateYaml(broken, broken, good)).toEqual({ merged: good, conflicts: [] });
  });

  it("conflicts on the whole file otherwise", () => {
    const { merged, conflicts } = mergeStateYaml(good, broken, state({ [B]: { status: "pending" } }));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatch(/^state\.yaml \(/);
    expect(merged.startsWith("<<<<<<< ours\nitems:\n")).toBe(true);
    expect(merged.endsWith(">>>>>>> theirs\n")).toBe(true);
  });
});

describe("readFolderSpecs", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "rex-state-merge-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const doc = (fields: Record<string, unknown>): string =>
    ["---", ...Object.entries(fields).map(([k, v]) => `${k}: ${JSON.stringify(v)}`), "---", ""].join("\n");

  it("reads capability and constraint specs from the folder's index and leaves", async () => {
    await writeFile(
      join(dir, "index.md"),
      doc({ id: A, type: "capability", title: "Pay", slug: "pay", statement: BASE_SPEC.statement, criteria: BASE_SPEC.criteria }),
    );
    await writeFile(join(dir, "pci.md"), doc({ id: B, type: "constraint", title: "PCI", slug: "pci", statement: "No card numbers at rest." }));
    await writeFile(join(dir, "task.md"), doc({ id: C, type: "task", title: "Wire it", slug: "task" }));
    await mkdir(join(dir, "child"));

    const specs = await readFolderSpecs(dir);

    expect([...specs.keys()].sort()).toEqual([A, B]);
    expect(specHash(specs.get(A)!)).toBe(specHash(BASE_SPEC));
    expect(specs.get(B)).toEqual({ statement: "No card numbers at rest." });
  });

  it("reads a missing folder as no specs", async () => {
    expect((await readFolderSpecs(join(dir, "absent"))).size).toBe(0);
  });
});
