import { describe, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  contentHash,
  stableJson,
  type MigrationDefinition,
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

const bootstrapDefinition: MigrationDefinition<Route[], RouteEntry, { routes: number }> = {
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
};
const bootstrap = defineMigration(bootstrapDefinition);

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
  it("summarize rebuilds the summary from the entries every pass produced", async () => {
    const summarized = defineMigration<Route[], RouteEntry, { routes: number; judged?: number }>({
      ...bootstrapDefinition,
      summarize: (entries, summary) => ({ ...summary, judged: Object.values(entries).filter((e) => e.confidence !== undefined).length }),
    });
    const rules = await summarized.plan(routeSource(ROUTES()), { cutAt: CUT });
    expect(rules.summary).toEqual({ routes: 2, judged: 0 });
    const full = await summarized.plan(routeSource(ROUTES()), { cutAt: CUT, seams: { text: textSeam(), jev: jevSeam() } });
    expect(full.summary).toEqual({ routes: 2, judged: 2 });
  });

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

  describe("a seam that fails mid-pass", () => {
    const THREE = (): Route[] => [...ROUTES(), { path: "/teams", handler: "listTeams" }];
    const failingOnThird = () => {
      let calls = 0;
      return seam("text-model", (q) => {
        if (++calls === 3) throw new Error("rate limited");
        return `Answers ${(q.question as { draft: string }).draft}.`;
      });
    };
    const FOUR = (): Route[] => [...THREE(), { path: "/users", handler: "listUsers" }];

    it("keeps the answers so far, marks the pass incomplete and skips later passes", async () => {
      const jev = jevSeam();
      const plan = await bootstrap.plan(routeSource(FOUR()), { cutAt: CUT, seams: { text: failingOnThird(), jev } });
      expect(plan.header.passes).toEqual([{ name: "rules" }, { name: "text", model: "text-model", incomplete: { error: "rate limited" } }]);
      expect(Object.keys(plan.answers.text ?? {})).toEqual(["/tasks", "/runs"]);
      expect(plan.entries["/runs"]?.statement).toBe("Answers listRuns.");
      expect(plan.entries["/teams"]?.statement).toBeUndefined();
      expect(jev.ask).not.toHaveBeenCalled();
    });

    it("lets a re-plan with that output as previous skip the answered items", async () => {
      const failed = await bootstrap.plan(routeSource(THREE()), { cutAt: CUT, seams: { text: failingOnThird() } });
      const previous = parsePlanFile(formatPlanFile(failed));
      const text = textSeam();
      const retried = await bootstrap.plan(routeSource(THREE()), { cutAt: CUT, seams: { text }, previous });
      expect(text.ask).toHaveBeenCalledTimes(1);
      expect(text.ask).toHaveBeenCalledWith({ id: "/teams", question: { draft: "listTeams" } });
      expect(retried.header.passes[1]).toEqual({ name: "text", model: "text-model" });
    });

    it("keeps earlier answers for items after the failure", async () => {
      const first = await bootstrap.plan(routeSource(FOUR()), { cutAt: CUT, seams: { text: textSeam() } });
      const changed = FOUR();
      changed[0] = { path: "/tasks", handler: "listTasksV2" };
      const failing = seam("text-model", () => {
        throw new Error("down");
      });
      const plan = await bootstrap.plan(routeSource(changed), { cutAt: CUT, seams: { text: failing }, previous: first });
      expect(failing.ask).toHaveBeenCalledTimes(1);
      expect(Object.keys(plan.answers.text ?? {})).toEqual(["/runs", "/teams", "/users"]);
    });

    describe("after a complete text+jev plan", () => {
      const changedTasks = () => {
        const routes = THREE();
        routes[0] = { path: "/tasks", handler: "listTasksV2" };
        return routes;
      };
      const down = () =>
        seam("text-model", () => {
          throw new Error("down");
        });

      it("carries the earlier Jev answers when the text seam throws", async () => {
        const first = await bootstrap.plan(routeSource(THREE()), { cutAt: CUT, seams: { text: textSeam(), jev: jevSeam() } });
        const jev = jevSeam();
        const failed = await bootstrap.plan(routeSource(changedTasks()), { cutAt: CUT, seams: { text: down(), jev }, previous: first });
        expect(jev.ask).not.toHaveBeenCalled();
        expect(failed.answers.jev).toEqual(first.answers.jev);
        expect(failed.header.passes.map((p) => p.name)).toEqual(["rules", "text"]);
      });

      it("asks Jev on a re-plan from that output only for items whose question changed", async () => {
        const first = await bootstrap.plan(routeSource(THREE()), { cutAt: CUT, seams: { text: textSeam(), jev: jevSeam() } });
        const failed = await bootstrap.plan(routeSource(changedTasks()), { cutAt: CUT, seams: { text: down(), jev: jevSeam() }, previous: first });
        const previous = parsePlanFile(formatPlanFile(failed));
        const jev = jevSeam();
        await bootstrap.plan(routeSource(changedTasks()), { cutAt: CUT, seams: { text: textSeam(), jev }, previous });
        expect(jev.ask).toHaveBeenCalledTimes(1);
        expect(jev.ask).toHaveBeenCalledWith({ id: "/tasks", question: { judge: "Answers listTasksV2." } });
      });
    });

    it("is distinguishable from a complete plan when read back", async () => {
      const failed = await bootstrap.plan(routeSource(THREE()), { cutAt: CUT, seams: { text: failingOnThird() } });
      expect(parsePlanFile(formatPlanFile(failed)).header.passes[1]?.incomplete).toEqual({ error: "rate limited" });
      const done = await bootstrap.plan(routeSource(THREE()), { cutAt: CUT, seams: { text: textSeam() } });
      expect(parsePlanFile(formatPlanFile(done)).header.passes.some((p) => p.incomplete)).toBe(false);
    });
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

  it("plans items whose ids name Object.prototype members", async () => {
    const routes = [
      { path: "constructor", handler: "build" },
      { path: "toString", handler: "render" },
    ];
    const first = await bootstrap.plan(routeSource(routes), { cutAt: CUT, seams: { text: textSeam() } });
    expect(first.entries.constructor).toEqual({ target: "capability", title: "build", statement: "Answers build." });
    const text = textSeam();
    await bootstrap.plan(routeSource(routes), { cutAt: CUT, seams: { text }, previous: parsePlanFile(formatPlanFile(first)) });
    expect(text.ask).not.toHaveBeenCalled();
  });

  it("refuses a question about an item with no entry, even one named like a prototype member", async () => {
    const stray = defineMigration<Route[], RouteEntry, null>({
      id: "stray-proto",
      from: "a",
      to: "b",
      rules: () => ({ entries: {}, summary: null }),
      passes: { text: { questions: () => [{ id: "constructor", question: 1 }], merge: (e) => e } },
    });
    const source = routeSource([{ path: "constructor", handler: "build" }]);
    await expect(stray.plan(source, { cutAt: CUT, seams: { text: textSeam() } })).rejects.toThrow(/no source item and entry/);
  });

  describe("stages", () => {
    type StagedEntry = RouteEntry & { derived?: boolean };
    const draftStage = (id: string) => ({
      model: "text" as const,
      questions: (entries: Readonly<Record<string, StagedEntry>>) => [{ id, question: { draft: entries[id]!.title, derived: entries[id]!.derived ?? false } }],
      merge: (entry: StagedEntry, answer: unknown) => ({ ...entry, statement: String(answer) }),
    });
    /** Text drafts /tasks, Jev judges it, a derive stage marks every entry, then text drafts /runs. */
    const staged = defineMigration<Route[], StagedEntry, { routes: number }>({
      id: "staged",
      from: "map",
      to: "v2",
      rules: bootstrapDefinition.rules,
      stages: [
        draftStage("/tasks"),
        {
          model: "jev",
          questions: (entries) => [{ id: "/tasks", question: { judge: entries["/tasks"]!.statement } }],
          merge: (entry, answer) => ({ ...entry, confidence: Number(answer) }),
        },
        { derive: (entries) => Object.fromEntries(Object.entries(entries).map(([id, e]) => [id, { ...e, derived: true }])) },
        draftStage("/runs"),
      ],
    });
    const draftSeam = () => seam("text-model", (q) => `Answers ${(q.question as { draft: string }).draft}.`);

    it("run in order, each reading the entries the stages before it left, with one answer map per model", async () => {
      const text = draftSeam();
      const jev = jevSeam();
      const plan = await staged.plan(routeSource(ROUTES()), { cutAt: CUT, seams: { text, jev } });
      expect(text.ask.mock.calls.map(([q]) => q)).toEqual([
        { id: "/tasks", question: { draft: "listTasks", derived: false } },
        { id: "/runs", question: { draft: "listRuns", derived: true } },
      ]);
      expect(jev.ask).toHaveBeenCalledWith({ id: "/tasks", question: { judge: "Answers listTasks." } });
      expect(plan.header.passes).toEqual([{ name: "rules" }, { name: "text", model: "text-model" }, { name: "jev", model: "jev-model" }]);
      expect(Object.keys(plan.answers.text ?? {})).toEqual(["/tasks", "/runs"]);

      const again = { text: draftSeam(), jev: jevSeam() };
      const second = await staged.plan(routeSource(ROUTES()), { cutAt: CUT, seams: again, previous: parsePlanFile(formatPlanFile(plan)) });
      expect(again.text.ask).not.toHaveBeenCalled();
      expect(again.jev.ask).not.toHaveBeenCalled();
      expect(formatPlanFile(second)).toBe(formatPlanFile(plan));
    });

    it("refuse a model asking about one item in two stages", async () => {
      const twice = defineMigration<Route[], StagedEntry, { routes: number }>({ ...bootstrapDefinition, id: "twice", passes: undefined, stages: [draftStage("/tasks"), draftStage("/tasks")] });
      await expect(twice.plan(routeSource(ROUTES()), { cutAt: CUT, seams: { text: draftSeam() } })).rejects.toThrow(/text pass asked about \/tasks twice/);
    });

    it("refuse a migration that defines both passes and stages", async () => {
      const both = defineMigration<Route[], StagedEntry, { routes: number }>({ ...bootstrapDefinition, id: "both", stages: [] });
      await expect(both.plan(routeSource(ROUTES()), { cutAt: CUT })).rejects.toThrow(/both passes and stages/);
    });

    it("after a seam error, still derive, skip later model stages and keep their earlier answers", async () => {
      const first = await staged.plan(routeSource(ROUTES()), { cutAt: CUT, seams: { text: draftSeam(), jev: jevSeam() } });
      const changed = ROUTES();
      changed[0] = { path: "/tasks", handler: "listTasksV2" };
      const down = seam("jev-model", () => {
        throw new Error("down");
      });
      const text = draftSeam();
      const plan = await staged.plan(routeSource(changed), { cutAt: CUT, seams: { text, jev: down }, previous: first });
      expect(plan.header.passes).toEqual([
        { name: "rules" },
        { name: "text", model: "text-model" },
        { name: "jev", model: "jev-model", incomplete: { error: "down" } },
      ]);
      expect(text.ask).toHaveBeenCalledTimes(1);
      expect(plan.entries["/runs"]?.derived).toBe(true);
      expect(plan.entries["/runs"]?.statement).toBeUndefined();
      expect(plan.answers.text?.["/runs"]).toEqual(first.answers.text?.["/runs"]);
      expect(plan.answers.jev).toEqual({});
    });
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
