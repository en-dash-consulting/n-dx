import { describe, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  contentHash,
  stableJson,
  type MigrationSource,
  type ModelQuestion,
  type PassSeam,
} from "../../../src/migrations/migration.js";
import { defineMigration } from "../../../src/migrations/pipeline.js";
import { formatPlanFile, parsePlanFile, readPlanFile, writePlanFile } from "../../../src/migrations/plan-file.js";

// A stub migration whose source is not a PRD tree: routes from a codebase map.
interface Route {
  path: string;
  handler: string;
}
interface RouteEntry {
  target: "capability";
  title: string;
  statement?: string;
  confidence?: number;
}

function routeSource(routes: Route[]): MigrationSource<Route[]> {
  return {
    kind: "codebase-map",
    read: () => ({ data: routes, items: routes.map((r) => ({ id: r.path, hash: contentHash(r) })) }),
  };
}

const bootstrap = defineMigration<Route[], RouteEntry, { routes: number }>({
  id: "map-to-v2",
  from: "map",
  to: "v2",
  rules: (routes) => ({
    entries: Object.fromEntries(routes.map((r) => [r.path, { target: "capability" as const, title: r.handler }])),
    summary: { routes: routes.length },
  }),
  passes: {
    text: {
      questions: (entries) => Object.entries(entries).map(([id, e]) => ({ id, question: { draft: e.title } })),
      merge: (entry, answer) => ({ ...entry, statement: String(answer) }),
    },
    jev: {
      questions: (entries) => Object.entries(entries).map(([id, e]) => ({ id, question: { judge: e.statement } })),
      merge: (entry, answer) => ({ ...entry, confidence: Number(answer) }),
    },
  },
});

const ROUTES = (): Route[] => [
  { path: "/tasks", handler: "listTasks" },
  { path: "/runs", handler: "listRuns" },
];
const CUT = "2026-10-08T00:00:00.000Z";

function seam(model: string, answer: (q: ModelQuestion) => unknown): PassSeam & { ask: ReturnType<typeof vi.fn> } {
  return { model, ask: vi.fn(async (q: ModelQuestion) => answer(q)) };
}
const textSeam = (model = "text-model") => seam(model, (q) => `Answers ${(q.question as { draft: string }).draft}.`);
const jevSeam = () => seam("jev-model", () => 0.9);

describe("plan pipeline", () => {
  it("plans a source that is not a PRD tree and writes a valid plan file", async () => {
    const plan = await bootstrap.plan(routeSource(ROUTES()), { cutAt: CUT });
    expect(plan.header).toMatchObject({ migration: "map-to-v2", from: "map", to: "v2", cutAt: CUT, passes: [{ name: "rules" }] });
    expect(plan.header.source.kind).toBe("codebase-map");
    expect(Object.keys(plan.entries)).toEqual(["/tasks", "/runs"]);
    expect(plan.summary).toEqual({ routes: 2 });

    const dir = await mkdtemp(join(tmpdir(), "pipeline-"));
    try {
      const path = join(dir, "plan.json");
      await writePlanFile(path, plan);
      expect(await readPlanFile(path)).toEqual(plan);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("runs rules, then text, then Jev, recording each pass's model", async () => {
    const text = textSeam();
    const jev = jevSeam();
    const plan = await bootstrap.plan(routeSource(ROUTES()), { cutAt: CUT, seams: { jev, text } });
    expect(plan.header.passes).toEqual([{ name: "rules" }, { name: "text", model: "text-model" }, { name: "jev", model: "jev-model" }]);
    expect(plan.entries["/tasks"]).toEqual({ target: "capability", title: "listTasks", statement: "Answers listTasks.", confidence: 0.9 });
    // Jev judged the statement the text pass wrote.
    expect(jev.ask).toHaveBeenCalledWith({ id: "/tasks", question: { judge: "Answers listTasks." } });
    expect(Object.keys(plan.answers.text ?? {})).toEqual(["/tasks", "/runs"]);
  });

  it("skips a model pass with no seam", async () => {
    const plan = await bootstrap.plan(routeSource(ROUTES()), { cutAt: CUT, seams: { text: textSeam() } });
    expect(plan.header.passes.map((p) => p.name)).toEqual(["rules", "text"]);
    expect(plan.answers.jev).toBeUndefined();
    expect(plan.entries["/tasks"]?.confidence).toBeUndefined();
  });

  it("reuses an unchanged item's recorded answer without calling the seam, and asks again for a changed item", async () => {
    const first = await bootstrap.plan(routeSource(ROUTES()), { cutAt: CUT, seams: { text: textSeam() } });
    const previous = parsePlanFile(formatPlanFile(first));

    const changed = ROUTES();
    changed[1] = { path: "/runs", handler: "listRunsByTask" };
    const text = textSeam();
    const second = await bootstrap.plan(routeSource(changed), { cutAt: CUT, seams: { text }, previous });

    expect(text.ask).toHaveBeenCalledTimes(1);
    expect(text.ask).toHaveBeenCalledWith({ id: "/runs", question: { draft: "listRunsByTask" } });
    expect(second.entries["/tasks"]?.statement).toBe("Answers listTasks.");
    expect(second.entries["/runs"]?.statement).toBe("Answers listRunsByTask.");
    expect(second.answers.text?.["/tasks"]).toEqual(first.answers.text?.["/tasks"]);
  });

  it("reuses every answer for an unchanged source: the plan file is byte-identical", async () => {
    const first = await bootstrap.plan(routeSource(ROUTES()), { cutAt: CUT, seams: { text: textSeam(), jev: jevSeam() } });
    const previous = parsePlanFile(formatPlanFile(first));
    const text = textSeam();
    const jev = jevSeam();
    const second = await bootstrap.plan(routeSource(ROUTES()), { cutAt: CUT, seams: { text, jev }, previous });
    expect(text.ask).not.toHaveBeenCalled();
    expect(jev.ask).not.toHaveBeenCalled();
    expect(formatPlanFile(second)).toBe(formatPlanFile(first));
  });

  it("asks again when the model changed", async () => {
    const first = await bootstrap.plan(routeSource(ROUTES()), { cutAt: CUT, seams: { text: textSeam("old-model") } });
    const text = textSeam("new-model");
    await bootstrap.plan(routeSource(ROUTES()), { cutAt: CUT, seams: { text }, previous: first });
    expect(text.ask).toHaveBeenCalledTimes(2);
  });

  it("drops recorded answers the plan no longer uses", async () => {
    const first = await bootstrap.plan(routeSource(ROUTES()), { cutAt: CUT, seams: { text: textSeam() } });
    const second = await bootstrap.plan(routeSource(ROUTES().slice(0, 1)), { cutAt: CUT, seams: { text: textSeam() }, previous: first });
    expect(Object.keys(second.answers.text ?? {})).toEqual(["/tasks"]);
  });

  it("changes the source digest when an item changes", async () => {
    const a = await bootstrap.plan(routeSource(ROUTES()), { cutAt: CUT });
    const b = await bootstrap.plan(routeSource([{ path: "/tasks", handler: "other" }, ROUTES()[1]!]), { cutAt: CUT });
    expect(b.header.source.digest).not.toBe(a.header.source.digest);
  });

  describe("refuses", () => {
    it("an earlier plan of another migration", async () => {
      const other = await bootstrap.plan(routeSource(ROUTES()), { cutAt: CUT });
      const previous = { ...other, header: { ...other.header, migration: "v1-to-v2" } };
      await expect(bootstrap.plan(routeSource(ROUTES()), { cutAt: CUT, previous })).rejects.toThrow(/for migration v1-to-v2/);
    });

    it("a cutAt that is not a time", async () => {
      await expect(bootstrap.plan(routeSource(ROUTES()), { cutAt: "now" })).rejects.toThrow(/cutAt/);
    });

    it("a source with duplicate ids", async () => {
      const routes = [ROUTES()[0]!, ROUTES()[0]!];
      await expect(bootstrap.plan(routeSource(routes), { cutAt: CUT })).rejects.toThrow(/duplicate item id \/tasks/);
    });

    it("a question about an item the source does not have", async () => {
      const stray = defineMigration<Route[], RouteEntry, null>({
        id: "stray",
        from: "a",
        to: "b",
        rules: () => ({ entries: {}, summary: null }),
        passes: { text: { questions: () => [{ id: "/nowhere", question: 1 }], merge: (e) => e } },
      });
      await expect(stray.plan(routeSource(ROUTES()), { cutAt: CUT, seams: { text: textSeam() } })).rejects.toThrow(/\/nowhere/);
    });
  });
});

describe("stableJson", () => {
  it("ignores key order and drops undefined members", () => {
    expect(stableJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: undefined } })).toBe('{"a":{"d":[1,{"x":1,"y":2}]},"b":1}');
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
  });
});
