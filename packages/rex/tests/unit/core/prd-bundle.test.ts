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
import { isModifiedSinceSync } from "../../../src/core/sync.js";
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
  it("captures the whole document in the bundle envelope", () => {
    const bundle = buildBundle(makeDoc());

    expect(bundle.bundle).toBe(BUNDLE_KIND);
    expect(bundle.bundleVersion).toBe(BUNDLE_VERSION);
    expect(bundle.schema).toBe(SCHEMA_VERSION);
    expect(bundle.title).toBe("Test PRD");
    expect(bundle.items).toHaveLength(2);
    expect(bundle.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // `makeDoc()` is already at the running version, so the assertion above
  // cannot tell `doc.schema` from `SCHEMA_VERSION`. These three can.
  it("labels the bundle with the document's schema, not the exporter's", () => {
    const doc = { ...makeDoc(), schema: "rex/v1.1" };

    expect(buildBundle(doc).schema).toBe("rex/v1.1");
  });

  it("falls back to the running schema when the document carries none", () => {
    // `PRDDocument.schema` is typed as required, but a legacy backend load
    // parses whatever the file holds — an absent marker must not produce a
    // bundle labelled `undefined`, which no version gate can read.
    const doc = { ...makeDoc() } as PRDDocument;
    delete (doc as { schema?: string }).schema;

    expect(buildBundle(doc).schema).toBe(SCHEMA_VERSION);
  });

  it("keeps a newer-minor document refusable by a rex that cannot read it", () => {
    // The whole point of stamping the document's own version. `isCompatibleSchema`
    // admits newer minors and `.passthrough()` keeps their unrecognised fields,
    // so a document written by a future rex loads here intact. Relabelling it
    // down to the running version on export made `parseBundle`'s minor gate
    // compare 0 > 0 — never firing — and those fields then reached the tree
    // unvalidated, which is exactly what the gate exists to prevent.
    const bundle = buildBundle({ ...makeDoc(), schema: "rex/v1.1" });
    const roundTripped = JSON.parse(JSON.stringify(bundle)) as unknown;

    expect(() => parseBundle(roundTripped)).toThrow(BundleError);
    expect(() => parseBundle(roundTripped)).toThrow(/newer than this rex supports/);
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

  it("strips remote-sync bookkeeping but keeps content attribution", () => {
    const doc = makeDoc();
    const sourceTask = (doc.items[0].children as PRDItem[])[0].children![0];
    sourceTask.lastSyncedAt = "2026-02-01T00:00:00.000Z";
    sourceTask.remoteId = "notion-page-123";

    const bundle = buildBundle(doc);
    const exported = (bundle.items[0].children as PRDItem[])[0].children![0];

    // Another project's remote pointers must not travel: a carried
    // lastSyncedAt >= lastModified would make the item read as unchanged in
    // the destination, whose first pull then overwrites it in silence.
    expect(exported.lastSyncedAt).toBeUndefined();
    expect(exported.remoteId).toBeUndefined();
    expect(isModifiedSinceSync(exported)).toBe(true);

    // Attribution is content and stays.
    expect(exported.lastModified).toBe("2026-01-01T00:00:00.000Z");
    expect(exported.lastModifiedBy).toBe("someone <someone@example.com>");

    // The strip happens on the clone — the source document keeps its state.
    expect(sourceTask.lastSyncedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(sourceTask.remoteId).toBe("notion-page-123");
  });
});

describe("parseBundle", () => {
  it("round-trips a built bundle through JSON", () => {
    const bundle = buildBundle(makeDoc());
    const parsed = parseBundle(JSON.parse(JSON.stringify(bundle)));
    expect(parsed).toEqual(bundle);
  });

  it("strips remote-sync bookkeeping from bundles rex did not write", () => {
    // rex export never emits these, but an older rex or a hand-authored
    // bundle can — the no-foreign-remote-pointers guarantee holds here too.
    const raw = JSON.parse(JSON.stringify(buildBundle(makeDoc()))) as {
      items: PRDItem[];
    };
    raw.items[0].lastSyncedAt = "2026-02-01T00:00:00.000Z";
    raw.items[0].remoteId = "foreign-page-1";

    const parsed = parseBundle(raw);

    expect(parsed.items[0].lastSyncedAt).toBeUndefined();
    expect(parsed.items[0].remoteId).toBeUndefined();
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

  it("rejects a blockedBy cycle, naming the items in it", () => {
    // A cycle imports cleanly today and only surfaces afterwards, as a wedged
    // `get_next_task` and `report`. Rejecting here costs nothing: parseBundle
    // runs before the store is touched at all.
    const doc = makeDoc();
    const t1 = (doc.items[0].children as PRDItem[])[0].children![0];
    t1.blockedBy = ["t2"]; // t2 is already blockedBy t1
    const bundle = JSON.parse(JSON.stringify(buildBundle(doc))) as unknown;

    expect(() => parseBundle(bundle)).toThrow(BundleError);
    expect(() => parseBundle(bundle)).toThrow(/cycle/i);
    expect(() => parseBundle(bundle)).toThrow(/t1/);
  });

  it("rejects an item that blocks itself", () => {
    const doc = makeDoc();
    (doc.items[0].children as PRDItem[])[0].children![0].blockedBy = ["t1"];
    const bundle = JSON.parse(JSON.stringify(buildBundle(doc))) as unknown;

    expect(() => parseBundle(bundle)).toThrow(BundleError);
    expect(() => parseBundle(bundle)).toThrow(/t1/);
  });

  it("accepts a blockedBy edge pointing outside the bundle", () => {
    // Not a cycle, and not this validator's business: a merge resolves such an
    // edge against the local tree, and a scoped export deliberately drops the
    // ones it cannot close. Rejecting these would refuse valid imports, which
    // is why the cycle check is used here rather than validateDAG wholesale.
    const doc = makeDoc();
    (doc.items[0].children as PRDItem[])[0].children![0].blockedBy = ["lives-locally"];
    const bundle = JSON.parse(JSON.stringify(buildBundle(doc))) as unknown;

    expect(() => parseBundle(bundle)).not.toThrow();
  });

  it("rejects a bundle whose root item is not root-legal, naming the level", () => {
    // Only an epic may sit at PRD root (LEVEL_HIERARCHY.epic === [null]).
    // In replace mode the bundle's tree *becomes* the tree, so a feature at
    // root would be saved as an illegal placement with no complaint.
    const bundle = {
      ...buildBundle(makeDoc()),
      items: [makeItem({ id: "f-root", title: "Rootless Feature", level: "feature" })],
    };
    const raw = JSON.parse(JSON.stringify(bundle)) as unknown;

    expect(() => parseBundle(raw)).toThrow(BundleError);
    expect(() => parseBundle(raw)).toThrow(/feature/);
    expect(() => parseBundle(raw)).toThrow(/root/i);
  });

  it("rejects a bundle nesting a child under an illegal parent level, naming both", () => {
    const bundle = {
      ...buildBundle(makeDoc()),
      items: [
        makeItem({
          id: "e-x",
          title: "Epic X",
          level: "epic",
          children: [makeItem({ id: "s-x", title: "Subtask X", level: "subtask" })],
        }),
      ],
    };
    const raw = JSON.parse(JSON.stringify(bundle)) as unknown;

    expect(() => parseBundle(raw)).toThrow(BundleError);
    expect(() => parseBundle(raw)).toThrow(/subtask/);
    expect(() => parseBundle(raw)).toThrow(/epic/);
  });

  it("accepts a task directly under an epic, which the hierarchy allows", () => {
    // LEVEL_HIERARCHY.task === ["feature", "epic"] — the check must not
    // assume one canonical depth per level.
    const bundle = {
      ...buildBundle(makeDoc()),
      items: [
        makeItem({
          id: "e-y",
          title: "Epic Y",
          level: "epic",
          children: [makeItem({ id: "t-y", title: "Task Y", level: "task" })],
        }),
      ],
    };
    const raw = JSON.parse(JSON.stringify(bundle)) as unknown;

    expect(() => parseBundle(raw)).not.toThrow();
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

  it("refuses to graft under a local parent whose level was re-levelled, naming both levels", () => {
    // The case parseBundle cannot see: the bundle's own structure is legal
    // (f1 under epic e1), but locally e1 has since been reshaped into a task,
    // and a feature under a task is illegal. The graft target is the local
    // tree's, so only mergeBundle can catch this.
    const bundle = buildBundle(makeDoc());
    const existing: PRDItem[] = [
      makeItem({
        id: "eX",
        title: "Epic X",
        level: "epic",
        children: [
          makeItem({ id: "tX", title: "Task X", level: "task", children: [
            // Same id as the bundle's epic, but re-levelled locally.
            makeItem({ id: "e1", title: "Epic One, now a task", level: "task" }),
          ] }),
        ],
      }),
    ];

    expect(() => mergeBundle(existing, bundle, "merge")).toThrow(BundleError);
    expect(() => mergeBundle(existing, bundle, "merge")).toThrow(/feature/);
    expect(() => mergeBundle(existing, bundle, "merge")).toThrow(/task/);
  });

  it("refuses to add a non-root-legal bundle item at the local tree root", () => {
    // Merge mode pushes unseen bundle roots onto the local root list. A
    // feature there is as illegal as it would be in replace mode.
    const bundle = {
      ...buildBundle(makeDoc()),
      items: [makeItem({ id: "f-loose", title: "Loose Feature", level: "feature" })],
    };

    expect(() => mergeBundle([], bundle, "merge")).toThrow(BundleError);
    expect(() => mergeBundle([], bundle, "merge")).toThrow(/root/i);
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

  /**
   * An item that arrives with attribution but no timestamp would otherwise be
   * invisible to sync forever: the store keeps the partial stamp as-is
   * (deliberately — re-stamping overwrote the original author), and
   * isModifiedSinceSync treats a missing lastModified as "never modified".
   * The bundle's exportedAt is the honest default: the content is at least
   * that old.
   */
  describe("timestamp defaulting for attribution-only items", () => {
    function attributionOnlyBundle(mode?: { exportedAt?: string }) {
      const doc = makeDoc();
      const epicTwo = doc.items[1];
      (epicTwo.children as PRDItem[])[0].lastModifiedBy = "someone <someone@example.com>";
      return buildBundle(doc, { exportedAt: mode?.exportedAt ?? "2026-02-02T00:00:00.000Z" });
    }

    it("defaults lastModified to the bundle's exportedAt in merge mode, keeping the author", () => {
      const bundle = attributionOnlyBundle();
      const outcome = mergeBundle([], bundle, "merge");

      const t2 = outcome.items[1].children?.[0] as PRDItem;
      expect(t2.lastModified).toBe("2026-02-02T00:00:00.000Z");
      expect(t2.lastModifiedBy).toBe("someone <someone@example.com>");
    });

    it("defaults the same way in replace mode", () => {
      const bundle = attributionOnlyBundle();
      const outcome = mergeBundle(
        [makeItem({ id: "local", title: "Local only", level: "epic" })],
        bundle,
        "replace",
      );

      const t2 = outcome.items[1].children?.[0] as PRDItem;
      expect(t2.lastModified).toBe("2026-02-02T00:00:00.000Z");
      expect(t2.lastModifiedBy).toBe("someone <someone@example.com>");
    });

    it("makes the defaulted item visible to sync as never-synced local work", () => {
      const outcome = mergeBundle([], attributionOnlyBundle(), "merge");
      expect(isModifiedSinceSync(outcome.items[1].children?.[0] as PRDItem)).toBe(true);
    });

    it("never overwrites a timestamp the item brought with it", () => {
      const bundle = attributionOnlyBundle();
      const outcome = mergeBundle([], bundle, "merge");

      // t1 carries its own full stamp in the fixture.
      const t1 = (outcome.items[0].children as PRDItem[])[0].children?.[0] as PRDItem;
      expect(t1.lastModified).toBe("2026-01-01T00:00:00.000Z");
    });

    it("leaves an item with neither field unstamped, for the store to stamp on write", () => {
      const bundle = attributionOnlyBundle();
      const outcome = mergeBundle([], bundle, "merge");

      // e2 has no stamp at all in the fixture; inventing one here would hide
      // it from the transaction's own stamping.
      const e2 = outcome.items[1];
      expect(e2.lastModified).toBeUndefined();
      expect(e2.lastModifiedBy).toBeUndefined();
    });
  });
});
