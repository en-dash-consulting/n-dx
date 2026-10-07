import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  SCHEMA_VERSION_V2,
  isV2Schema,
  NODE_TYPES,
  PRODUCT_NODE_TYPES,
  CHANGE_NODE_TYPES,
  layerOf,
  isNodeType,
  isDisplayId,
  isWorkRef,
  CriterionSchema,
  AmendmentSchema,
  WorkRefSchema,
  NodeIntentSchema,
  ItemStateSchema,
  RETIRED_STATE_FIELDS,
  StateFileSchema,
  RootHeaderSchema,
  AreaIntentSchema,
  CapabilityIntentSchema,
  ConstraintIntentSchema,
  ChangeIntentSchema,
  TaskIntentSchema,
  SubtaskIntentSchema,
  type TaskIntent,
} from "../../../src/schema/v2.js";
import { RUN_SETTING_KEYS, type PRDItem } from "../../../src/schema/v1.js";
import { PRDItemSchema, validateRunSettings } from "../../../src/schema/validate.js";

const ID = "0b5f0c9e-1111-4222-8333-444455556666";

describe("schema stamp", () => {
  it("is rex/v2 and accepts only the v2 major", () => {
    expect(SCHEMA_VERSION_V2).toBe("rex/v2");
    expect(isV2Schema("rex/v2")).toBe(true);
    expect(isV2Schema("rex/v2.1")).toBe(true);
    expect(isV2Schema("rex/v1")).toBe(false);
    expect(isV2Schema("rex/v20")).toBe(false);
    expect(isV2Schema(undefined)).toBe(false);
  });
});

describe("node types", () => {
  it("is the closed set, split by layer", () => {
    expect([...NODE_TYPES]).toEqual(["area", "capability", "constraint", "change", "task", "subtask"]);
    expect([...PRODUCT_NODE_TYPES]).toEqual(["area", "capability", "constraint"]);
    expect([...CHANGE_NODE_TYPES]).toEqual(["change", "task", "subtask"]);
    for (const type of PRODUCT_NODE_TYPES) expect(layerOf(type)).toBe("product");
    for (const type of CHANGE_NODE_TYPES) expect(layerOf(type)).toBe("changes");
    expect(isNodeType("epic")).toBe(false);
    expect(isNodeType("spike")).toBe(false);
  });

  it("refuses an item that names a level but no type", () => {
    const r = NodeIntentSchema.safeParse({ id: ID, level: "task", title: "T", slug: "t" });
    expect(r.success).toBe(false);
  });

  it("refuses spike as a type; spike is a flag on a change", () => {
    expect(NodeIntentSchema.safeParse({ id: ID, type: "spike", title: "S", slug: "s" }).success).toBe(false);
    const r = NodeIntentSchema.safeParse({ id: ID, type: "change", title: "S", slug: "s", spike: true });
    expect(r.success).toBe(true);
  });
});

describe("display ids", () => {
  it("accepts change and product forms", () => {
    for (const ok of ["CH-1", "CH-142", "A4", "A4.3", "CH-142.2"]) expect(isDisplayId(ok)).toBe(true);
  });
  it("rejects malformed forms", () => {
    for (const bad of ["ch-1", "CH-", "A", "4.3", "A4.", "CH-1a", ""]) expect(isDisplayId(bad)).toBe(false);
  });
  it("is validated on every node, with aliases", () => {
    const base = { id: ID, type: "change", title: "C", slug: "c" };
    expect(NodeIntentSchema.safeParse({ ...base, displayId: "CH-7", aliases: ["CH-3", ID] }).success).toBe(true);
    expect(NodeIntentSchema.safeParse({ ...base, displayId: "change 7" }).success).toBe(false);
  });
});

describe("work refs (prs, issues)", () => {
  it("accepts full URLs and tracker keys", () => {
    for (const ok of [
      "https://github.com/en-dash-consulting/n-dx/pull/525",
      "https://bitbucket.org/acme/web/pull-requests/12",
      "https://acme.atlassian.net/browse/WM-2054",
      "WM-2054",
      "ABC2-7",
    ]) {
      expect(isWorkRef(ok), ok).toBe(true);
      expect(WorkRefSchema.safeParse(ok).success).toBe(true);
    }
  });

  it("rejects unexpanded short forms", () => {
    for (const bad of ["en-dash-consulting/n-dx#525", "acme/web#12", "#525", "525", "wm-2054", "ftp://x/y", ""]) {
      expect(isWorkRef(bad), bad).toBe(false);
    }
  });

  it("is enforced on change state", () => {
    expect(ItemStateSchema.safeParse({ prs: ["owner/repo#4"] }).success).toBe(false);
    expect(ItemStateSchema.safeParse({ issues: ["#4"] }).success).toBe(false);
    expect(ItemStateSchema.safeParse({ prs: ["https://github.com/o/r/pull/4"], issues: ["WM-1"] }).success).toBe(true);
  });
});

describe("criteria and amendments", () => {
  it("criteria carry ids", () => {
    expect(CriterionSchema.safeParse({ id: "c1", text: "When x, the system shall y" }).success).toBe(true);
    expect(CriterionSchema.safeParse({ text: "no id" }).success).toBe(false);
  });

  it("accepts a criterion-level delta", () => {
    const r = AmendmentSchema.safeParse({
      target: ID,
      delta: "modified",
      summary: "Tighten the retry rule",
      criteria: { add: [{ id: "c4", text: "new" }], replace: [{ id: "c2", text: "changed" }], remove: ["c3"] },
    });
    expect(r.success).toBe(true);
  });

  it("accepts an added capability with proposed text under a parent", () => {
    const r = AmendmentSchema.safeParse({
      target: "A4.9",
      delta: "added",
      summary: "New capability",
      proposed: "The system exports a narrative report.",
      under: "A4",
      title: "Export a narrative report",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown delta", () => {
    expect(AmendmentSchema.safeParse({ target: ID, delta: "renamed", summary: "x" }).success).toBe(false);
  });
});

describe("per-type intent", () => {
  it("area summary is an optional string", () => {
    const area = { id: ID, type: "area", title: "Store", slug: "store" };
    expect(AreaIntentSchema.safeParse({ ...area, summary: "Where PRD state lives." }).success).toBe(true);
    expect(AreaIntentSchema.safeParse(area).success).toBe(true);
    expect(AreaIntentSchema.safeParse({ ...area, summary: 3 }).success).toBe(false);
  });

  it("parses each node type", () => {
    const common = { id: ID, title: "Node", slug: "node" };
    expect(AreaIntentSchema.safeParse({ ...common, type: "area", stewards: ["ryan.k@endash.us", "@acme/web"] }).success).toBe(true);
    expect(
      CapabilityIntentSchema.safeParse({
        ...common,
        type: "capability",
        statement: "The system does x.",
        criteria: [{ id: "c1", text: "y" }],
        requirements: [],
        dependsOn: [ID],
      }).success,
    ).toBe(true);
    expect(ConstraintIntentSchema.safeParse({ ...common, type: "constraint", statement: "s", appliesTo: "all" }).success).toBe(true);
    expect(ConstraintIntentSchema.safeParse({ ...common, type: "constraint", appliesTo: [ID] }).success).toBe(true);
    expect(ConstraintIntentSchema.safeParse({ ...common, type: "constraint", appliesTo: "some" }).success).toBe(false);
    expect(
      ChangeIntentSchema.safeParse({
        ...common,
        type: "change",
        intent: "Why",
        amends: [{ target: ID, delta: "removed", summary: "gone" }],
        touches: [ID],
        plannedRelease: "1.0.0",
        spike: false,
        priority: "high",
      }).success,
    ).toBe(true);
    expect(TaskIntentSchema.safeParse({ ...common, type: "task", priority: "low", acceptanceCriteria: ["a"] }).success).toBe(true);
    expect(SubtaskIntentSchema.safeParse({ ...common, type: "subtask" }).success).toBe(true);
  });

  it("types loe as engineer-weeks, accepting the string form frontmatter yields", () => {
    const task = { id: ID, type: "task", title: "T", slug: "t" };
    expect(TaskIntentSchema.parse({ ...task, loe: 1.5 }).loe).toBe(1.5);
    expect(TaskIntentSchema.parse({ ...task, loe: "2" }).loe).toBe(2);
    expect(ChangeIntentSchema.parse({ ...task, type: "change", loe: 0.5 }).loe).toBe(0.5);
    for (const bad of ["lots", "", 0, -1]) {
      expect(TaskIntentSchema.safeParse({ ...task, loe: bad }).success, String(bad)).toBe(false);
    }
  });

  it("declares loeRationale and loeConfidence beside loe on change and task", () => {
    for (const type of ["change", "task"]) {
      const base = { id: ID, type, title: "T", slug: "t", loe: 1 };
      const ok = NodeIntentSchema.parse({ ...base, loeRationale: "Bounded scope.", loeConfidence: "medium" }) as Record<string, unknown>;
      expect(ok.loeRationale).toBe("Bounded scope.");
      expect(ok.loeConfidence).toBe("medium");
      expect(NodeIntentSchema.safeParse({ ...base, loeConfidence: "certain" }).success, type).toBe(false);
      expect(NodeIntentSchema.safeParse({ ...base, loeRationale: 3 }).success, type).toBe(false);
    }
  });

  it("records an optional discoveredFrom item and run on a change", () => {
    const change = { id: ID, type: "change", title: "C", slug: "c" };
    expect(ChangeIntentSchema.parse(change).discoveredFrom).toBeUndefined();
    const both = ChangeIntentSchema.parse({ ...change, discoveredFrom: { item: ID, run: "run-42" } });
    expect(both.discoveredFrom).toEqual({ item: ID, run: "run-42" });
    expect(ChangeIntentSchema.safeParse({ ...change, discoveredFrom: { item: ID } }).success).toBe(true);
    expect(ChangeIntentSchema.safeParse({ ...change, discoveredFrom: { run: "run-42" } }).success).toBe(true);
    // A newer writer's provenance key without item or run must survive an older reader.
    const newer = ChangeIntentSchema.parse({ ...change, discoveredFrom: { session: "s1" } });
    expect(newer.discoveredFrom).toEqual({ session: "s1" });
    for (const bad of [ID, { item: 3 }, { run: "" }, { item: "" }]) {
      expect(ChangeIntentSchema.safeParse({ ...change, discoveredFrom: bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("declares run on change and task with RUN_SETTING_KEYS as its known keys", () => {
    for (const schema of [ChangeIntentSchema, TaskIntentSchema]) {
      expect(Object.keys(schema.shape.run.unwrap().shape)).toEqual([...RUN_SETTING_KEYS]);
    }
  });

  it("keeps run loose: a malformed or newer-version block round-trips unchanged", () => {
    const malformed = { tier: "gigantic", maxTurns: -4, models: { acme: "" }, futureKey: { nested: true } };
    for (const type of ["change", "task"]) {
      const node = { id: ID, type, title: "T", slug: "t", run: malformed };
      const parsed = NodeIntentSchema.parse(node) as Record<string, unknown>;
      expect(parsed.run, type).toEqual(malformed);
      // The strict check stays at writers.
      expect(validateRunSettings(parsed.run).ok).toBe(false);
    }
  });

  it("refuses a run that is not an object", () => {
    for (const bad of ["heavy", [{ tier: "heavy" }], 3]) {
      expect(TaskIntentSchema.safeParse({ id: ID, type: "task", title: "T", slug: "t", run: bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("maps a v1 task's run block to a v2 task unchanged", () => {
    const v1Task = {
      id: ID,
      title: "T",
      status: "pending",
      level: "task",
      run: { tier: "heavy", models: { claude: "claude-opus-5-5" }, review: true, maxTurns: 40, contextNotes: "Keep it small." },
    } satisfies PRDItem;
    expect(PRDItemSchema.safeParse(v1Task).success).toBe(true);
    const v2Task: TaskIntent = { id: v1Task.id, type: "task", title: v1Task.title, slug: "t", run: v1Task.run };
    expect(TaskIntentSchema.parse(v2Task).run).toEqual(v1Task.run);
  });

  it("dispatches on type in the union", () => {
    const r = NodeIntentSchema.safeParse({ id: ID, type: "constraint", title: "C", slug: "c", appliesTo: "nope" });
    expect(r.success).toBe(false);
  });

  it("reserves hypotheses without a shape", () => {
    for (const hypotheses of [[{ any: 1 }], { h1: "x" }, "free text"]) {
      expect(NodeIntentSchema.safeParse({ id: ID, type: "capability", title: "C", slug: "c", hypotheses }).success).toBe(true);
    }
  });

  it("reserves effort without a shape on change and task", () => {
    const planned = { tier: "strong", loe: 1, confidence: "high", reasons: ["r"], source: "recommender", at: "2026-10-07T00:00:00.000Z" };
    for (const type of ["change", "task"]) {
      for (const effort of [planned, "free text", 3]) {
        expect(NodeIntentSchema.safeParse({ id: ID, type, title: "T", slug: "t", effort }).success, type).toBe(true);
      }
    }
  });
});

describe("state", () => {
  it("parses the full state field set", () => {
    const r = ItemStateSchema.safeParse({
      status: "completed",
      startedAt: "2026-10-06T00:00:00.000Z",
      completedAt: "2026-10-06T01:00:00.000Z",
      endedAt: "2026-10-06T01:00:00.000Z",
      activeIntervals: [{ start: "2026-10-06T00:00:00.000Z", end: "2026-10-06T01:00:00.000Z" }],
      failureReason: "x",
      resolutionType: "code-change",
      resolutionDetail: "y",
      metAt: "sha256:abc",
      revisedAt: "2026-10-06T01:00:00.000Z",
      specReviewed: true,
      checks: [{ requirementId: "r1", result: "pass", at: "2026-10-06T01:00:00.000Z" }],
      appliedIn: "e3d7052fe",
      shippedIn: "1.0.0",
      prs: ["https://github.com/o/r/pull/1"],
      issues: ["WM-1"],
      links: [{ anything: "goes" }],
      assignee: "Ryan Keith <ryan.k@endash.us>",
      ready: true,
      needsPlacement: false,
      lastModified: "2026-10-06T01:00:00.000Z",
      lastModifiedBy: "Ryan Keith <ryan.k@endash.us>",
    });
    expect(r.success).toBe(true);
  });

  it("declares no commits field: commits are computed from N-DX-Item trailers", () => {
    expect(ItemStateSchema.shape).not.toHaveProperty("commits");
    expect(RETIRED_STATE_FIELDS).toHaveProperty("commits");
    // An old entry that still carries commits passes through untouched.
    const commits = [{ hash: "a".repeat(40), author: "R", authorEmail: "r@x", timestamp: "2026-10-06T01:00:00.000Z" }];
    const r = ItemStateSchema.safeParse({ status: "completed", commits });
    expect(r.success && r.data.commits).toEqual(commits);
  });

  it("allows an empty entry (absent status reads as pending)", () => {
    expect(ItemStateSchema.safeParse({}).success).toBe(true);
  });

  it("rejects an unknown status and an unknown check result", () => {
    expect(ItemStateSchema.safeParse({ status: "done" }).success).toBe(false);
    expect(ItemStateSchema.safeParse({ checks: [{ requirementId: "r", result: "maybe", at: "t" }] }).success).toBe(false);
  });

  it("keys a state file by item id under the v2 stamp", () => {
    expect(StateFileSchema.safeParse({ schema: "rex/v2", items: { [ID]: { status: "pending" } } }).success).toBe(true);
    expect(StateFileSchema.safeParse({ schema: "rex/v1", items: {} }).success).toBe(false);
  });
});

describe("root header", () => {
  it("carries title, stamp, project requirements and stewards", () => {
    const r = RootHeaderSchema.safeParse({ title: "n-dx", schema: "rex/v2", requirements: [], stewards: ["ryan.k@endash.us"] });
    expect(r.success).toBe(true);
    expect(RootHeaderSchema.safeParse({ title: "n-dx", schema: "rex/v1" }).success).toBe(false);
  });
});

describe("passthrough", () => {
  it("preserves unknown keys on intent, nested amendments, state, state file and root header", () => {
    const intent = NodeIntentSchema.parse({
      id: ID,
      type: "change",
      title: "C",
      slug: "c",
      futureField: 1,
      amends: [{ target: ID, delta: "modified", summary: "s", extra: true, criteria: { add: [], more: 2 } }],
    }) as Record<string, unknown>;
    expect(intent.futureField).toBe(1);
    const amend = (intent.amends as Array<Record<string, unknown>>)[0];
    expect(amend.extra).toBe(true);
    expect((amend.criteria as Record<string, unknown>).more).toBe(2);

    const state = ItemStateSchema.parse({ status: "pending", bridgeId: "x" }) as Record<string, unknown>;
    expect(state.bridgeId).toBe("x");

    const file = StateFileSchema.parse({ schema: "rex/v2", items: {}, note: "n" }) as Record<string, unknown>;
    expect(file.note).toBe("n");

    const root = RootHeaderSchema.parse({ title: "t", schema: "rex/v2", x: 1 }) as Record<string, unknown>;
    expect(root.x).toBe(1);
  });
});

describe("field coverage (design intent/state tables)", () => {
  const COMMON_INTENT = ["id", "type", "title", "slug", "displayId", "aliases", "tags", "source", "blockedBy", "body", "hypotheses"];
  const cases: Array<[string, { shape: Record<string, unknown> }, string[]]> = [
    ["area", AreaIntentSchema, ["summary", "stewards"]],
    ["capability", CapabilityIntentSchema, ["statement", "criteria", "requirements", "dependsOn"]],
    ["constraint", ConstraintIntentSchema, ["statement", "requirements", "appliesTo"]],
    ["change", ChangeIntentSchema, ["intent", "amends", "touches", "plannedRelease", "spike", "priority", "loe", "loeRationale", "loeConfidence", "effort", "requirements", "discoveredFrom", "run"]],
    ["task", TaskIntentSchema, ["description", "acceptanceCriteria", "requirements", "priority", "loe", "loeRationale", "loeConfidence", "effort", "run"]],
    ["subtask", SubtaskIntentSchema, ["description", "acceptanceCriteria"]],
  ];
  for (const [type, schema, fields] of cases) {
    it(`${type} intent declares every field`, () => {
      for (const f of [...COMMON_INTENT, ...fields]) expect(schema.shape, `${type}.${f}`).toHaveProperty(f);
    });
  }

  it("state declares every field", () => {
    const STATE = [
      "status", "startedAt", "completedAt", "endedAt", "activeIntervals",
      "failureReason", "resolutionType", "resolutionDetail",
      "metAt", "revisedAt", "specReviewed", "checks",
      "appliedIn", "shippedIn", "prs", "issues", "links",
      "assignee", "ready", "needsPlacement",
      "lastModified", "lastModifiedBy",
    ];
    for (const f of STATE) expect(ItemStateSchema.shape, f).toHaveProperty(f);
  });
});

describe("isolation", () => {
  it("no runtime module imports the v2 modules yet", () => {
    const srcRoot = join(import.meta.dirname, "../../../src");
    // The v2 modules (schema, rules, state writer, dual-read loader, tree
    // writer) may import each other; nothing else may import them until the
    // v2 store wires them in.
    const v2Files = new Set(
      ["schema/v2.ts", "schema/v2-rules.ts", "store/state-writer.ts", "store/prd-model-reader.ts", "store/prd-model-writer.ts", "core/product-edges.ts", "core/product-status.ts"].map(
        (f) => join(srcRoot, f),
      ),
    );
    const v2Import =
      /from\s+["'][^"']*(?:schema\/v2(?:-rules)?|\/state-writer|\/prd-model-(?:reader|writer))(?:\.js)?["']|from\s+["']\.\/v2(?:-rules)?(?:\.js)?["']/;
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith(".ts") && !v2Files.has(p)) {
          if (v2Import.test(readFileSync(p, "utf8"))) {
            offenders.push(relative(srcRoot, p));
          }
        }
      }
    };
    walk(srcRoot);
    expect(offenders).toEqual([]);
  });
});
