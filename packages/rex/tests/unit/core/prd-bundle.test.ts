import { describe, it, expect } from "vitest";
import {
  BUNDLE_KIND,
  BUNDLE_VERSION,
  buildBundle,
  parseBundle,
  mergeBundle,
  BundleError,
} from "../../../src/core/prd-bundle.js";
import { SCHEMA_VERSION } from "../../../src/schema/index.js";
import type { PRDDocument, PRDItem } from "../../../src/schema/index.js";

function makeItem(overrides: Partial<PRDItem> & { id: string; title: string }): PRDItem {
  return {
    status: "pending",
    level: "task",
    ...overrides,
  };
}

/** Two epics; the second epic's task is blocked by the first epic's task. */
function makeDoc(): PRDDocument {
  return {
    schema: SCHEMA_VERSION,
    title: "Test PRD",
    items: [
      makeItem({
        id: "e1",
        title: "Epic One",
        level: "epic",
        status: "in_progress",
        children: [
          makeItem({
            id: "f1",
            title: "Feature One",
            level: "feature",
            priority: "high",
            children: [
              makeItem({
                id: "t1",
                title: "Task One",
                description: "Does a thing",
                acceptanceCriteria: ["it does the thing"],
                tags: ["a", "b"],
                source: "ndx-capture",
                priority: "medium",
                branch: "main",
                lastModified: "2026-01-01T00:00:00.000Z",
                lastModifiedBy: "someone <someone@example.com>",
              }),
            ],
          }),
        ],
      }),
      makeItem({
        id: "e2",
        title: "Epic Two",
        level: "epic",
        children: [
          makeItem({ id: "t2", title: "Task Two", blockedBy: ["t1"] }),
        ],
      }),
    ],
  };
}

describe("buildBundle", () => {
  it("captures the whole document with its schema version", () => {
    const bundle = buildBundle(makeDoc());

    expect(bundle.bundle).toBe(BUNDLE_KIND);
    expect(bundle.bundleVersion).toBe(BUNDLE_VERSION);
    expect(bundle.schema).toBe(SCHEMA_VERSION);
    expect(bundle.title).toBe("Test PRD");
    expect(bundle.items).toHaveLength(2);
    expect(bundle.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("records export provenance when given", () => {
    const bundle = buildBundle(makeDoc(), { branch: "feat/x", commit: "abc1234" });
    expect(bundle.exportedFrom).toEqual({ branch: "feat/x", commit: "abc1234" });
  });

  it("does not alias the source document's items", () => {
    const doc = makeDoc();
    const bundle = buildBundle(doc);
    (bundle.items[0].children as PRDItem[])[0].title = "mutated";
    expect((doc.items[0].children as PRDItem[])[0].title).toBe("Feature One");
  });
});

describe("parseBundle", () => {
  it("round-trips a built bundle through JSON", () => {
    const bundle = buildBundle(makeDoc());
    const parsed = parseBundle(JSON.parse(JSON.stringify(bundle)));
    expect(parsed).toEqual(bundle);
  });

  it("rejects a payload that is not a rex bundle", () => {
    expect(() => parseBundle({ hello: "world" })).toThrow(BundleError);
    expect(() => parseBundle({ hello: "world" })).toThrow(/not a rex PRD bundle/i);
  });

  it("rejects a newer bundle format version", () => {
    const bundle = { ...buildBundle(makeDoc()), bundleVersion: BUNDLE_VERSION + 1 };
    expect(() => parseBundle(bundle)).toThrow(/newer/i);
  });

  it("rejects a newer schema minor version", () => {
    const bundle = { ...buildBundle(makeDoc()), schema: "rex/v1.1" };
    expect(() => parseBundle(bundle)).toThrow(/newer/i);
  });

  it("rejects a different schema major version", () => {
    const bundle = { ...buildBundle(makeDoc()), schema: "rex/v2" };
    expect(() => parseBundle(bundle)).toThrow(/incompatible/i);
  });

  it("accepts the running schema version", () => {
    const bundle = { ...buildBundle(makeDoc()), schema: SCHEMA_VERSION };
    expect(() => parseBundle(bundle)).not.toThrow();
  });

  it("rejects items that fail document validation", () => {
    const bundle = {
      ...buildBundle(makeDoc()),
      items: [{ id: "x", title: "No level or status" }],
    };
    expect(() => parseBundle(bundle)).toThrow(BundleError);
  });

  it("rejects a bundle carrying the same item id at two positions, naming the id", () => {
    // t1 already lives under f1; a second t1 under e2 is two items claiming
    // one identity. Imported with --replace this would land in the tree as-is,
    // where findItem/update/remove resolve it ambiguously.
    const doc = makeDoc();
    (doc.items[1].children as PRDItem[]).push(
      makeItem({ id: "t1", title: "Task One again" }),
    );
    const bundle = JSON.parse(JSON.stringify(buildBundle(doc))) as unknown;

    expect(() => parseBundle(bundle)).toThrow(BundleError);
    expect(() => parseBundle(bundle)).toThrow(/"t1"/);
  });

  it("rejects a duplicate id even when the copies are content-identical", () => {
    // Same id, same fields, different parents — still two tree entries, and
    // still ambiguous to every id-keyed operation after import.
    const doc = makeDoc();
    (doc.items[1].children as PRDItem[]).push(
      structuredClone((doc.items[0].children as PRDItem[])[0].children![0]),
    );
    const bundle = JSON.parse(JSON.stringify(buildBundle(doc))) as unknown;

    expect(() => parseBundle(bundle)).toThrow(/"t1"/);
  });
});

describe("mergeBundle", () => {
  it("adds every item when the target tree is empty", () => {
    const bundle = buildBundle(makeDoc());
    const outcome = mergeBundle([], bundle, "merge");

    expect(outcome.collisions).toEqual([]);
    expect(outcome.added).toBe(5);
    expect(outcome.items).toHaveLength(2);
  });

  it("preserves existing items and reports collisions whose content differs", () => {
    const bundle = buildBundle(makeDoc());
    const existing: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic One renamed locally",
        level: "epic",
        children: [makeItem({ id: "f1", title: "Feature One", level: "feature", priority: "high" })],
      }),
    ];

    const outcome = mergeBundle(existing, bundle, "merge");

    expect(outcome.items[0].title).toBe("Epic One renamed locally");
    const differing = outcome.collisions.filter((c) => c.kind === "differing");
    expect(differing.map((c) => c.id)).toEqual(["e1"]);
    expect(outcome.collisions.filter((c) => c.kind === "identical").map((c) => c.id)).toEqual(["f1"]);
  });

  it("grafts new descendants onto an existing parent", () => {
    const bundle = buildBundle(makeDoc());
    const existing: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic One",
        level: "epic",
        status: "in_progress",
        children: [],
      }),
    ];

    const outcome = mergeBundle(existing, bundle, "merge");
    const e1 = outcome.items.find((i) => i.id === "e1");

    expect(e1?.children?.map((c) => c.id)).toEqual(["f1"]);
    expect(outcome.items.map((i) => i.id)).toEqual(["e1", "e2"]);
  });

  it("treats an id that exists elsewhere in the tree as a collision, not a duplicate", () => {
    const bundle = buildBundle(makeDoc());
    // t1 lives under a different parent locally — importing must not clone it.
    const existing: PRDItem[] = [
      makeItem({
        id: "eX",
        title: "Some other epic",
        level: "epic",
        children: [makeItem({ id: "t1", title: "Task One", level: "task" })],
      }),
    ];

    const outcome = mergeBundle(existing, bundle, "merge");
    const ids: string[] = [];
    const walk = (items: PRDItem[]): void => {
      for (const i of items) {
        ids.push(i.id);
        if (i.children) walk(i.children);
      }
    };
    walk(outcome.items);

    expect(ids.filter((id) => id === "t1")).toHaveLength(1);
    expect(outcome.collisions.some((c) => c.id === "t1")).toBe(true);
  });

  it("replaces the tree wholesale in replace mode", () => {
    const bundle = buildBundle(makeDoc());
    const existing: PRDItem[] = [makeItem({ id: "local", title: "Local only", level: "epic" })];

    const outcome = mergeBundle(existing, bundle, "replace");

    expect(outcome.items.map((i) => i.id)).toEqual(["e1", "e2"]);
    expect(outcome.replaced).toBe(1);
  });

  it("does not alias the bundle's items into the merged tree", () => {
    const bundle = buildBundle(makeDoc());
    const outcome = mergeBundle([], bundle, "merge");
    outcome.items[0].title = "mutated";
    expect(bundle.items[0].title).toBe("Epic One");
  });
});
