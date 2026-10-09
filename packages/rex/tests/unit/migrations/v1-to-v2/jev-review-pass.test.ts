import { describe, it, expect, vi } from "vitest";
import type { JevAnswer } from "@n-dx/llm-client";
import type { ItemLevel, ItemStatus, PRDItem } from "../../../../src/schema/v1.js";
import type { PlacementJudge, PlacementSettings } from "../../../../src/core/placement-policy.js";
import { formatPlanFile, type PlanFile } from "../../../../src/migrations/plan-file.js";
import { v1ToV2, v1TreeSource, type V1ToV2Options } from "../../../../src/migrations/v1-to-v2/index.js";
import { MIGRATION_JUDGE_TASK_CLASS, reviewQueue } from "../../../../src/migrations/v1-to-v2/jev-review-pass.js";
import { planSeams, type PlanSeamOptions } from "../../../../src/migrations/v1-to-v2/seams.js";
import { choiceAnswer, mockJudge, noulAnswer } from "../../../helpers/jev-judge.js";
import { specHash } from "../../../../src/schema/v2-rules.js";

function item(id: string, level: ItemLevel, title: string, children: PRDItem[] = [], status: ItemStatus = "completed", extra: Partial<PRDItem> = {}): PRDItem {
  return { id, level, title, status, children, ...extra };
}

/** e1 is an area; f1 a capability whose one criterion links one test; t9 is held for placement. */
const tree = (): PRDItem[] => [
  item("e1", "epic", "Planning", [
    item("f1", "feature", "Task selection", [item("t1", "task", "Add priority ordering")], "completed", {
      acceptanceCriteria: ["Tasks follow priority ordering"],
    }),
    item("f2", "feature", "Folder storage", [item("t2", "task", "Write index files")]),
    item("t9", "task", "Tune selection speed", [], "pending"),
  ]),
];

const CUT = "2026-10-08T00:00:00.000Z";
const JEV_MODEL = "jev-test";
const TEST_FILE = "packages/rex/tests/unit/core/priority-ordering.test.ts";
const CONFIDENT: PlacementSettings = { models: "jev", autoAccept: "confident" };

function plan(
  settings: PlacementSettings,
  judge: PlacementJudge | undefined,
  extra: { previous?: PlanFile; options?: V1ToV2Options; seams?: Partial<PlanSeamOptions> } = {},
) {
  const seams = planSeams({ settings, ...(judge ? { jev: { model: JEV_MODEL, judge } } : {}), ...extra.seams });
  return v1ToV2.plan(v1TreeSource(tree()), {
    cutAt: CUT,
    seams,
    ...(extra.previous ? { previous: extra.previous } : {}),
    options: { placement: settings, testFiles: [TEST_FILE], ...extra.options },
  });
}

const judgeWith = (answers: Record<string, JevAnswer>) => mockJudge({ kind: choiceAnswer("change", 1), ...answers });

describe("v1-to-v2 Jev review", () => {
  it("the rules link f1's criterion to the test and hold t9", async () => {
    const rules = await v1ToV2.plan(v1TreeSource(tree()), { cutAt: CUT, options: { testFiles: [TEST_FILE] } });
    expect(rules.entries.f1?.spec?.criteria).toMatchObject([{ id: "c1", requirement: "f1:c1", tests: [TEST_FILE] }]);
    expect(rules.entries.t9).toMatchObject({ needsPlacement: true });
    expect(rules.summary.reviewQueue).toEqual([{ id: "t9", held: true }]);
  });

  it("asks one request per item, batching its questions under the migration judge class, held items first", async () => {
    const judge = judgeWith({ place: choiceAnswer("f1", 0.5) });
    await plan(CONFIDENT, judge);
    const asked = judge.mock.calls.map(([request, opts]) => ({ questions: Object.keys(request.questions).sort(), opts }));
    expect(asked).toEqual([
      { questions: ["kind", "place"], opts: { taskClass: MIGRATION_JUDGE_TASK_CLASS } },
      { questions: ["job"], opts: { taskClass: MIGRATION_JUDGE_TASK_CLASS } },
      { questions: ["criterion:c1", "link:l1"], opts: { taskClass: MIGRATION_JUDGE_TASK_CLASS } },
    ]);
  });

  it("an uncertain item carries Jev's choice and confidence, and below the threshold stays held", async () => {
    const p = await plan(CONFIDENT, judgeWith({ place: choiceAnswer("f1", 0.5), kind: choiceAnswer("change", 0.6) }));
    expect(p.entries.t9).toMatchObject({
      needsPlacement: true,
      jevReview: { kind: { choice: "change", confidence: 0.6 } },
      modelPlacement: { accepted: null, jev: { pick: "f1", confidence: 0.5 } },
      confidence: 0.5,
    });
    expect(p.entries.t9?.placement).toBeUndefined();
  });

  it("a kind other than the rules' is flagged, never applied", async () => {
    const p = await plan(CONFIDENT, judgeWith({ place: choiceAnswer("f1", 0.5), kind: choiceAnswer("capability", 0.95) }));
    expect(p.entries.t9).toMatchObject({ target: "change", needsPlacement: true, jevReview: { kind: { choice: "capability" } } });
    expect(p.entries.t9?.reasons.at(-1)).toContain("Jev reads it as a capability");
    expect(p.summary.jevReview?.otherKind).toBe(1);
  });

  it("flags an area Jev judges not job-shaped, with its probability", async () => {
    const p = await plan(CONFIDENT, judgeWith({ place: choiceAnswer("f1", 0.5), job: noulAnswer(0.2) }));
    expect(p.entries.e1?.jevReview?.jobShaped?.probability).toBe(0.2);
    expect(p.entries.e1?.jevReview?.jobShaped?.confidence).toBeCloseTo(0.6);
    const area = p.summary.areas.find((a) => a.id === "e1")!;
    expect(area.jevJobShaped).toBe(0.2);
    expect(area.notes.at(-1)).toContain("not named for a job");
    expect(p.summary.jevReview?.flaggedAreas).toBe(1);
  });

  it("drops a test link Jev judges irrelevant under autoAccept confident, and counts it", async () => {
    const p = await plan(CONFIDENT, judgeWith({ place: choiceAnswer("f1", 0.5), "link:l1": noulAnswer(0.05) }));
    const spec = p.entries.f1!.spec!;
    expect(spec.criteria).toEqual([{ id: "c1", text: spec.criteria[0]!.text, source: "f1" }]);
    expect(spec.requirements).toEqual([]);
    expect(spec.tests).toEqual([]);
    expect(spec.notes).toContain(`Jev judged ${TEST_FILE} does not exercise c1: link dropped`);
    expect(p.entries.f1?.jevReview?.testLinks).toEqual([{ criterion: "c1", test: TEST_FILE, probability: 0.05, confidence: 0.9, dropped: true }]);
    expect(p.summary.jevReview).toMatchObject({ droppedTestLinks: 1, flaggedTestLinks: 0 });
  });

  it("keeps and flags the link when autoAccept does not reach it", async () => {
    for (const autoAccept of ["agree", "none"] as const) {
      const p = await plan({ models: "jev", autoAccept }, judgeWith({ place: choiceAnswer("f1", 0.5), "link:l1": noulAnswer(0.05) }));
      expect(p.entries.f1?.spec?.criteria[0]?.tests).toEqual([TEST_FILE]);
      expect(p.summary.jevReview).toMatchObject({ droppedTestLinks: 0, flaggedTestLinks: 1 });
    }
  });

  it("after a dropped link, stamps reviewedHash only when the spec is the approved one", async () => {
    const drop = () => judgeWith({ place: choiceAnswer("f1", 0.5), "link:l1": noulAnswer(0.05) });
    const unreviewed = await plan(CONFIDENT, drop());
    const spec = unreviewed.entries.f1!.spec!;
    expect(spec.tests).toEqual([]);
    const current = specHash(spec);

    // Links are not hashed: the spec the reviewer approved is still the spec.
    const kept = await plan(CONFIDENT, drop(), { options: { reviewed: [{ id: "f1", hash: current }] } });
    expect(kept.entries.f1?.data?.reviewedHash).toBe(current);
    expect(kept.entries.f1?.data?.reviewNote).toBeUndefined();

    const stale = specHash({ statement: "Something older.", criteria: [] });
    const p = await plan(CONFIDENT, drop(), { options: { reviewed: [{ id: "f1", hash: stale }] } });
    expect(p.entries.f1?.data?.reviewedHash).toBeUndefined();
    expect(p.entries.f1?.data?.reviewNote).toContain(`approved ${stale}, current ${current}`);
    expect(p.summary.reviewQueue).toContainEqual(expect.objectContaining({ id: "f1", specChanged: true }));
  });

  it("flags a criterion Jev reads as process", async () => {
    const p = await plan(CONFIDENT, judgeWith({ place: choiceAnswer("f1", 0.5), "criterion:c1": noulAnswer(0.1) }));
    expect(p.entries.f1?.jevReview?.criteria).toEqual({ c1: { probability: 0.1, confidence: 0.8 } });
    expect(p.entries.f1?.spec?.criteria).toHaveLength(1);
    expect(p.entries.f1?.spec?.notes.at(-1)).toContain("as process");
    expect(p.summary.jevReview?.flaggedCriteria).toBe(1);
  });

  it("the review queue lists held items first, then entries by ascending confidence", async () => {
    const p = await plan(
      CONFIDENT,
      judgeWith({ place: choiceAnswer("f1", 0.9), job: noulAnswer(0.7), "criterion:c1": noulAnswer(0.99) }),
    );
    // t9 is placed at 0.9, so it is no longer held: it queues by confidence, between e1 (0.4) and f1 (0.98).
    expect(p.entries.t9?.placement).toBe("f1");
    expect(p.summary.reviewQueue.map((q) => q.id)).toEqual(["e1", "t9", "f1"]);

    const held = await plan(
      CONFIDENT,
      judgeWith({ place: choiceAnswer("f1", 0.7), job: noulAnswer(0.6), "criterion:c1": noulAnswer(0.95) }),
    );
    expect(held.summary.reviewQueue).toEqual([
      { id: "t9", held: true, confidence: 0.7 },
      { id: "e1", held: false, confidence: expect.closeTo(0.2) },
      { id: "f1", held: false, confidence: expect.closeTo(0.9) },
    ]);
  });

  describe("flag threshold", () => {
    // p 0.45 is confidence 0.1: Jev is undecided. p 0.2 is confidence 0.6.
    const undecided = () => judgeWith({ place: choiceAnswer("f1", 0.5), "criterion:c1": noulAnswer(0.45), "link:l1": noulAnswer(0.45), job: noulAnswer(0.45) });

    it("records an undecided answer but raises no note or flag", async () => {
      const p = await plan(CONFIDENT, undecided());
      expect(p.entries.f1?.jevReview?.criteria).toEqual({ c1: { probability: 0.45, confidence: expect.closeTo(0.1) } });
      expect(p.entries.f1?.jevReview?.testLinks).toMatchObject([{ probability: 0.45, dropped: false }]);
      expect(p.entries.f1?.spec?.notes.join("\n")).not.toMatch(/Jev (reads|doubts)/);
      expect(p.summary.areas.find((a) => a.id === "e1")?.notes.join("\n")).not.toContain("Jev reads the title");
      expect(p.summary.jevReview).toMatchObject({ flaggedCriteria: 0, flaggedTestLinks: 0, flaggedAreas: 0 });
    });

    it("flags the same answers at the default threshold once confident", async () => {
      const p = await plan(CONFIDENT, judgeWith({ place: choiceAnswer("f1", 0.5), "criterion:c1": noulAnswer(0.2), "link:l1": noulAnswer(0.4) }));
      // 0.2 → confidence 0.6 flags; 0.4 → 0.2 does not.
      expect(p.summary.jevReview).toMatchObject({ flaggedCriteria: 1, flaggedTestLinks: 0 });
    });

    it("takes the threshold from the migration options", async () => {
      const lax = await plan(CONFIDENT, undecided(), { options: { jevFlagMinConfidence: 0 } });
      expect(lax.summary.jevReview).toMatchObject({ flaggedCriteria: 1, flaggedTestLinks: 1, flaggedAreas: 1 });
      expect(lax.entries.f1?.spec?.notes.join("\n")).toContain("as process");
      const strict = await plan(
        CONFIDENT,
        judgeWith({ place: choiceAnswer("f1", 0.5), "criterion:c1": noulAnswer(0.2) }),
        { options: { jevFlagMinConfidence: 0.7 } },
      );
      expect(strict.summary.jevReview?.flaggedCriteria).toBe(0);
      await expect(plan(CONFIDENT, undecided(), { options: { jevFlagMinConfidence: 2 } })).rejects.toThrow(/jevFlagMinConfidence/);
    });

    it("ranks entries by confident flags, never an undecided answer above a confident flag", () => {
      const base = { target: "capability", reasons: [] } as never;
      const noul = (probability: number) => ({ probability, confidence: Math.abs(2 * probability - 1) });
      const entry = (id: string, confidence: number, criteria: Record<string, ReturnType<typeof noul>>) =>
        ({ ...base, id, confidence, jevReview: { criteria } }) as never;
      const queue = reviewQueue({
        undecided: entry("undecided", 0.01, { c1: noul(0.495) }),
        one: entry("one", 0.6, { c1: noul(0.2) }),
        two: entry("two", 0.8, { c1: noul(0.1), c2: noul(0.15) }),
        sure: entry("sure", 0.9, { c1: noul(0.9) }),
      });
      expect(queue.map((q) => q.id)).toEqual(["two", "one", "undecided", "sure"]);
    });
  });

  it("without a key the pass is skipped with one warning, and the plan equals the plan without it", async () => {
    const judge = judgeWith({});
    const warn = vi.fn();
    const skipped = await plan(CONFIDENT, judge, { seams: { jevAvailable: false, warn } });
    const without = await plan(CONFIDENT, undefined);
    expect(judge).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("TYPESAFE_API_KEY");
    expect(formatPlanFile(skipped)).toBe(formatPlanFile(without));
  });

  it("the jevReview option reviews when rex.placement leaves Jev out of placement", async () => {
    const judge = judgeWith({ kind: choiceAnswer("change", 0.4) });
    const p = await plan({ models: "text", autoAccept: "agree" }, judge, { seams: { jevReview: true } });
    expect(judge.mock.calls.map(([r]) => Object.keys(r.questions).sort())).toEqual([["kind"], ["job"], ["criterion:c1", "link:l1"]]);
    expect(p.entries.t9).toMatchObject({ needsPlacement: true, confidence: 0.4, jevReview: { kind: { choice: "change" } } });
    expect(p.entries.t9?.modelPlacement).toBeUndefined();

    const off = vi.fn();
    await plan({ models: "text", autoAccept: "agree" }, judge, { seams: { jevAvailable: false, jevReview: true, warn: off } });
    expect(off).toHaveBeenCalledTimes(1);
  });

  it("records Jev's answers, and an unchanged re-run reuses them", async () => {
    const first = await plan(CONFIDENT, judgeWith({ place: choiceAnswer("f1", 0.5), job: noulAnswer(0.2) }));
    expect(Object.keys(first.answers.jev ?? {}).sort()).toEqual(["e1", "f1", "t9"]);
    expect(first.answers.jev?.e1).toMatchObject({ model: JEV_MODEL, answer: { answers: { job: { type: "noul", noul: 0.2 } } } });

    const judge = judgeWith({});
    const again = await plan(CONFIDENT, judge, { previous: first });
    expect(judge).not.toHaveBeenCalled();
    expect(formatPlanFile(again)).toBe(formatPlanFile(first));
  });

  it("a response missing a review answer stops the pass instead of recording it", async () => {
    const full = judgeWith({ place: choiceAnswer("f1", 0.5) });
    const judge = vi.fn<PlacementJudge>(async (request, opts) => {
      const { job: _job, ...answers } = (await full(request, opts)).answers;
      return { model: "jev-1.0.0", answers };
    });
    const p = await plan(CONFIDENT, judge);
    expect(p.header.passes.at(-1)?.incomplete?.error).toContain("job");
    // The held change, asked first, is recorded; the area whose answer lacked "job" is not.
    expect(Object.keys(p.answers.jev ?? {})).toEqual(["t9"]);
  });
});
