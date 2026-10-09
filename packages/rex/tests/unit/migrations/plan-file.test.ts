import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatPlanFile,
  parsePlanFile,
  readPlanFile,
  writePlanFile,
  type PlanFile,
} from "../../../src/migrations/plan-file.js";

const plan = (): PlanFile => ({
  format: "ndx-migration-plan",
  version: 1,
  header: {
    migration: "v1-to-v2",
    from: "v1",
    to: "v2",
    source: { kind: "rex-v1-tree", digest: "abc" },
    cutAt: "2026-10-08T00:00:00.000Z",
    passes: [{ name: "rules" }, { name: "text", model: "text-model" }],
  },
  summary: { counts: { area: 1 } },
  entries: { "epic-1": { target: "area", reasons: ["an area"] }, "task-2": { target: "change", applied: true } },
  answers: { text: { "epic-1": { hash: "h1", model: "text-model", answer: { statement: "Plans work." } } } },
});

describe("plan file", () => {
  it("round-trips: writing then reading returns an equal plan", () => {
    const original = plan();
    expect(parsePlanFile(formatPlanFile(original))).toEqual(original);
  });

  it("round-trips through a file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "plan-file-"));
    try {
      const path = join(dir, "plan.json");
      await writePlanFile(path, plan());
      expect(await readPlanFile(path)).toEqual(plan());
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes keys in a fixed order whatever order the plan was built in", () => {
    const original = plan();
    const reordered = {
      answers: original.answers,
      entries: original.entries,
      summary: original.summary,
      header: { ...original.header, passes: original.header.passes, cutAt: original.header.cutAt, migration: original.header.migration },
      version: original.version,
      format: original.format,
    } as PlanFile;
    expect(formatPlanFile(reordered)).toBe(formatPlanFile(original));
    expect(Object.keys(JSON.parse(formatPlanFile(reordered)))).toEqual(["format", "version", "header", "summary", "entries", "answers"]);
    expect(formatPlanFile(original).endsWith("}\n")).toBe(true);
  });

  it("keeps a null answer", () => {
    const original = plan();
    original.answers.text!["epic-1"]!.answer = null;
    expect(parsePlanFile(formatPlanFile(original))).toEqual(original);
  });

  describe("refuses what it cannot read", () => {
    const text = (edit: (raw: Record<string, any>) => void): string => {
      const raw = JSON.parse(formatPlanFile(plan()));
      edit(raw);
      return JSON.stringify(raw);
    };

    it.each([
      ["not JSON", "{", /not a migration plan file/],
      ["another format", text((r) => (r.format = "something-else")), /format/],
      ["a newer version", text((r) => (r.version = 2)), /version/],
      ["no rules pass first", text((r) => (r.header.passes = [{ name: "text", model: "m" }])), /rules pass runs first/],
      ["a model pass with no model", text((r) => (r.header.passes = [{ name: "rules" }, { name: "jev" }])), /names its model/],
      ["a rules pass with a model", text((r) => (r.header.passes = [{ name: "rules", model: "m" }])), /names its model/],
      ["a cutAt that is not a time", text((r) => (r.header.cutAt = "soon")), /cutAt/],
      ["an answer with no answer", text((r) => delete r.answers.text["epic-1"].answer), /holds an answer/],
      ["an unknown pass's answers", text((r) => (r.answers.other = {})), /answers/],
      ["an unknown top-level key", text((r) => (r.extra = true)), /extra|Unrecognized/],
    ])("%s", (_name, input, problem) => {
      expect(() => parsePlanFile(input)).toThrow(problem);
    });
  });
});
