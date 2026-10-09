import { describe, it, expect, vi } from "vitest";
import type { ItemLevel, ItemStatus, PRDItem } from "../../../../src/schema/v1.js";
import type { PlacementModel } from "../../../../src/core/placement.js";
import { specHash } from "../../../../src/schema/v2-rules.js";
import { v1ToV2, v1TreeSource, type V1ToV2Options } from "../../../../src/migrations/v1-to-v2/index.js";
import { planSeams } from "../../../../src/migrations/v1-to-v2/seams.js";
import type { SpecAnswer, SpecModel, SpecQuestion } from "../../../../src/migrations/v1-to-v2/spec-pass.js";
import type { PlanFile } from "../../../../src/migrations/plan-file.js";

function item(id: string, level: ItemLevel, title: string, children: PRDItem[] = [], status: ItemStatus = "completed", extra: Partial<PRDItem> = {}): PRDItem {
  return { id, level, title, status, children, ...extra };
}

/** f1 is a capability with applied history t1 (and its subtask s1); t2 is unfinished. */
const tree = (): PRDItem[] => [
  item("e1", "epic", "Planning", [
    item(
      "f1",
      "feature",
      "Task selection",
      [
        item("t1", "task", "Add priority ordering", [item("s1", "subtask", "Break ties", [], "completed", { acceptanceCriteria: ["Ties break by creation time"] })], "completed", {
          acceptanceCriteria: ["Tasks follow priority ordering (test)", "Existing tests pass"],
        }),
        item("t2", "task", "Skip blocked tasks", [], "pending", { acceptanceCriteria: ["Blocked tasks are skipped"] }),
      ],
      "completed",
      { description: "Add task selection.", acceptanceCriteria: ["removes dead exports", "Docs are updated"] },
    ),
  ]),
];

const CUT = "2026-10-08T00:00:00.000Z";
const MODEL = "text-test";
const TEST_FILES = ["packages/rex/tests/unit/core/priority-ordering.test.ts"];

const drafter = (answer: SpecAnswer) => vi.fn<SpecModel>(async () => answer);

const GOOD: SpecAnswer = {
  statement: "Picks the next actionable task by priority.",
  criteria: [
    { text: "The system shall order tasks by priority.", source: "t1", tests: ["packages/rex/tests/unit/core/priority-ordering.test.ts"] },
    { text: "When two tasks tie, the system shall pick the older one.", source: "s1" },
  ],
};

function plan(draft: SpecModel, extra: { previous?: PlanFile; options?: V1ToV2Options; text?: PlacementModel; items?: PRDItem[] } = {}) {
  const seams = planSeams({
    settings: { models: "text", autoAccept: "agree" },
    spec: { model: MODEL, draft },
    ...(extra.text ? { text: { model: MODEL, place: extra.text } } : {}),
  });
  return v1ToV2.plan(v1TreeSource(extra.items ?? tree()), {
    cutAt: CUT,
    seams,
    ...(extra.previous ? { previous: extra.previous } : {}),
    options: { testFiles: TEST_FILES, ...extra.options },
  });
}

describe("v1-to-v2 spec text pass", () => {
  it("asks once per capability, with only its own item, applied history, code files and linked tests", async () => {
    const draft = drafter(GOOD);
    await plan(draft);
    expect(draft).toHaveBeenCalledTimes(1);
    const q = draft.mock.calls[0]![0] as SpecQuestion;
    expect(q.kind).toBe("spec");
    expect(q.capability).toMatchObject({ id: "f1", title: "Task selection", description: "Add task selection." });
    expect(q.history.map((h) => h.id)).toEqual(["t1", "s1"]);
    expect(q.tests).toEqual(TEST_FILES);
    expect(q.codeFiles).toEqual([]);
  });

  it("drafts a present-tense statement whose every criterion cites the source item it came from", async () => {
    const p = await plan(drafter(GOOD));
    const spec = p.entries.f1!.spec!;
    expect(spec.statement).toBe("Picks the next actionable task by priority.");
    expect(spec.draftedBy).toBe(MODEL);
    expect(spec.criteria).toEqual([
      { id: "c1", text: "The system shall order tasks by priority.", source: "t1", requirement: "f1:c1", tests: TEST_FILES },
      { id: "c2", text: "When two tasks tie, the system shall pick the older one.", source: "s1" },
    ]);
    for (const c of spec.criteria) expect(spec.sources).toContain(c.source);
    expect(spec.requirements.map((r) => r.id)).toEqual(["f1:c1"]);
  });

  it("rejects a criterion citing no source or one outside the capability, keeping the template criteria with a note", async () => {
    const p = await plan(
      drafter({
        statement: "Picks the next actionable task by priority.",
        criteria: [
          { text: "The system shall order tasks by priority.", source: "t1" },
          { text: "The system shall skip blocked tasks." },
          { text: "The system shall run on Windows.", source: "t2" },
        ],
      }),
    );
    const spec = p.entries.f1!.spec!;
    const texts = spec.criteria.map((c) => c.text);
    expect(texts).not.toContain("The system shall skip blocked tasks.");
    expect(texts).not.toContain("The system shall run on Windows.");
    // t1 is cited by an accepted criterion; f1 and s1 keep their template criteria.
    expect(spec.criteria.map((c) => [c.text, c.source])).toEqual([
      ["The system shall order tasks by priority.", "t1"],
      ["The system shall remove dead exports.", "f1"],
      ["The system shall ensure that ties break by creation time.", "s1"],
    ]);
    const notes = spec.notes.join("\n");
    expect(notes).toMatch(/"The system shall skip blocked tasks\.": it cites no source/);
    expect(notes).toMatch(/"The system shall run on Windows\.": it cites t2, outside the capability's sources/);
    expect(notes).toMatch(/kept the template criteria from f1, s1/);
  });

  it("keeps the template statement when the model's is not present tense", async () => {
    const p = await plan(drafter({ ...GOOD, statement: "This feature will add task selection." }));
    const spec = p.entries.f1!.spec!;
    expect(spec.statement).toBeUndefined();
    expect(spec.notes.join("\n")).toMatch(/not present tense/);
  });

  it("leaves process criteria out on the model path as on the template path", async () => {
    const p = await plan(
      drafter({
        statement: GOOD.statement,
        criteria: [...GOOD.criteria, { text: "All tests pass.", source: "t1" }, { text: "A changeset is added.", source: "f1" }],
      }),
    );
    const texts = p.entries.f1!.spec!.criteria.map((c) => c.text).join("\n");
    expect(texts).not.toMatch(/tests pass|changeset/i);
    const template = await v1ToV2.plan(v1TreeSource(tree()), { cutAt: CUT, options: { testFiles: TEST_FILES } });
    expect(template.entries.f1!.spec!.criteria.map((c) => c.text).join("\n")).not.toMatch(/tests pass|docs are updated/i);
  });

  it("links only the tests the question passed in", async () => {
    const p = await plan(drafter({ statement: GOOD.statement, criteria: [{ text: "The system shall order tasks by priority.", source: "t1", tests: ["packages/web/tests/x.test.ts"] }] }));
    const spec = p.entries.f1!.spec!;
    expect(spec.requirements).toEqual([]);
    expect(spec.notes.join("\n")).toMatch(/packages\/web\/tests\/x\.test\.ts, which the question did not pass in/);
  });

  it("carries no specReviewed field and leaves reviewedHash unset; a reviewed capability's hash follows the redrafted spec", async () => {
    const p = await plan(drafter(GOOD));
    expect(p.entries.f1!.spec).not.toHaveProperty("specReviewed");
    expect(p.entries.f1!.data?.reviewedHash).toBeUndefined();

    const reviewed = await plan(drafter(GOOD), { options: { reviewed: ["f1"] } });
    const spec = reviewed.entries.f1!.spec!;
    expect(reviewed.entries.f1!.data?.reviewedHash).toBe(specHash(spec));
  });

  it("records the answers in the plan and reuses them on an unchanged re-run", async () => {
    const first = await plan(drafter(GOOD));
    expect(first.header.passes).toEqual([{ name: "rules" }, { name: "text", model: MODEL }]);
    expect(first.answers.text?.f1).toMatchObject({ model: MODEL, answer: GOOD });

    const again = drafter({ statement: "Something else entirely happens here.", criteria: [] });
    const second = await plan(again, { previous: first });
    expect(again).not.toHaveBeenCalled();
    expect(second.entries.f1).toEqual(first.entries.f1);
    expect(second.answers.text).toEqual(first.answers.text);
  });

  it("asks again when an input the answer depends on changes", async () => {
    const first = await plan(drafter(GOOD));
    const again = drafter(GOOD);
    await plan(again, { previous: first, options: { codeFiles: { f1: ["packages/rex/src/core/next-task.ts"] } } });
    expect(again).toHaveBeenCalledTimes(1);
  });

  it("asks the parent again when a child task completes, though the parent's own source hash is unchanged", async () => {
    const first = await plan(drafter(GOOD));
    const later = tree();
    later[0]!.children![0]!.children![1]!.status = "completed";

    const again = drafter(GOOD);
    await plan(again, { previous: first, items: later });
    expect(again).toHaveBeenCalledTimes(1);
    expect((again.mock.calls[0]![0] as SpecQuestion).history.map((h) => h.id)).toContain("t2");
  });

  it("without a spec drafter the template draft stands", async () => {
    const template = await v1ToV2.plan(v1TreeSource(tree()), { cutAt: CUT, options: { testFiles: TEST_FILES } });
    const place = vi.fn<PlacementModel>(async () => null);
    const seams = planSeams({ settings: { models: "text", autoAccept: "agree" }, text: { model: MODEL, place } });
    const p = await v1ToV2.plan(v1TreeSource(tree()), { cutAt: CUT, seams, options: { testFiles: TEST_FILES } });
    expect(p.entries.f1!.spec).toEqual(template.entries.f1!.spec);
    expect(p.answers.text?.f1).toBeUndefined();
  });

  it("refuses a text placement model and a spec drafter on different models", () => {
    expect(() =>
      planSeams({ text: { model: "a", place: async () => null }, spec: { model: "b", draft: drafter(GOOD) } }),
    ).toThrow(/records one model/);
  });

  it("asks placement only when the placement tier includes text, even with a spec drafter", async () => {
    const place = vi.fn<PlacementModel>(async () => null);
    const seams = planSeams({ settings: { models: "jev", autoAccept: "confident" }, text: { model: MODEL, place }, spec: { model: MODEL, draft: drafter(GOOD) } });
    expect(seams.text?.kinds).toEqual(["spec"]);
  });
});
