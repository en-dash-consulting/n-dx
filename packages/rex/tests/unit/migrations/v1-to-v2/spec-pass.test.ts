import { describe, it, expect, vi } from "vitest";
import type { ItemLevel, ItemStatus, PRDItem } from "../../../../src/schema/v1.js";
import type { PlacementModel } from "../../../../src/core/placement.js";
import type { PlacementJudge, PlacementSettings } from "../../../../src/core/placement-policy.js";
import { specHash } from "../../../../src/schema/v2-rules.js";
import { v1ToV2, v1TreeSource, type V1ToV2Options } from "../../../../src/migrations/v1-to-v2/index.js";
import { planSeams } from "../../../../src/migrations/v1-to-v2/seams.js";
import type { SpecAnswer, SpecModel, SpecQuestion } from "../../../../src/migrations/v1-to-v2/spec-pass.js";
import { formatPlanFile, type PlanFile } from "../../../../src/migrations/plan-file.js";
import { choiceAnswer, mockJudge } from "../../../helpers/jev-judge.js";

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

  it("stores a drafted \"The system shall ensure that the system keeps …\" as \"The system shall keep …\"", async () => {
    const p = await plan(
      drafter({
        statement: "Picks the next actionable task by priority.",
        criteria: [{ text: "The system shall ensure that the system keeps ties ordered by creation time.", source: "t1" }],
      }),
    );
    const texts = p.entries.f1!.spec!.criteria.map((c) => c.text);
    expect(texts).toContain("The system shall keep ties ordered by creation time.");
    expect(texts.join("\n")).not.toContain("ensure that the system");
  });

  it("never stores an ungrammatical \"shall\" when dropping \"ensure that the system\"", async () => {
    const p = await plan(
      drafter({
        statement: "Picks the next actionable task by priority.",
        criteria: [
          { text: "The system shall ensure that the system does not pick blocked tasks.", source: "t1" },
          { text: "The system shall ensure that the system shall break ties by age.", source: "s1" },
          { text: "The system shall ensure that the system refreshes the queue.", source: "f1" },
        ],
      }),
    );
    expect(p.entries.f1!.spec!.criteria.map((c) => c.text)).toEqual([
      "The system shall not pick blocked tasks.",
      "The system shall break ties by age.",
      "The system refreshes the queue.",
    ]);
  });

  it("keeps the model's own subject: shall and When/While/If wording unchanged, a present-tense verb converted, an unconvertible one as written", async () => {
    const p = await plan(
      drafter({
        statement: "Picks the next actionable task by priority.",
        criteria: [
          { text: "The scheduler shall pick the oldest task.", source: "t1" },
          { text: "When a task is blocked, the scheduler shall skip it.", source: "s1" },
          { text: "The inventory lists every prompt surface", source: "f1" },
          { text: "The dashboard is refreshed on every write.", source: "t1" },
        ],
      }),
    );
    const texts = p.entries.f1!.spec!.criteria.map((c) => c.text);
    expect(texts).toEqual([
      "The scheduler shall pick the oldest task.",
      "When a task is blocked, the scheduler shall skip it.",
      "The inventory shall list every prompt surface.",
      "The dashboard is refreshed on every write.",
    ]);
    expect(texts.join("\n")).not.toContain("ensure that");
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

  it("carries no specReviewed field and leaves an unlisted capability's reviewedHash unset", async () => {
    const p = await plan(drafter(GOOD));
    expect(p.entries.f1!.spec).not.toHaveProperty("specReviewed");
    expect(p.entries.f1!.data?.reviewedHash).toBeUndefined();
  });

  it("stamps reviewedHash when the redraft is the spec the reviewer approved", async () => {
    const approved = specHash((await plan(drafter(GOOD))).entries.f1!.spec!);
    const p = await plan(drafter(GOOD), { options: { reviewed: [{ id: "f1", hash: approved }] } });
    expect(p.entries.f1!.data).toMatchObject({ approvedHash: approved, reviewedHash: approved });
    expect(p.entries.f1!.data?.reviewNote).toBeUndefined();
    expect(p.summary.reviewQueue.map((q) => q.id)).not.toContain("f1");
  });

  it("leaves a redraft that differs from the approved spec unreviewed, noted and queued", async () => {
    // The reviewer approved the template draft; the model then redrafted it.
    const template = await v1ToV2.plan(v1TreeSource(tree()), { cutAt: CUT, options: { testFiles: TEST_FILES } });
    const approved = specHash(template.entries.f1!.spec!);
    const p = await plan(drafter(GOOD), { options: { reviewed: [{ id: "f1", hash: approved }] } });
    const current = specHash(p.entries.f1!.spec!);
    expect(current).not.toBe(approved);
    expect(p.entries.f1!.data?.reviewedHash).toBeUndefined();
    expect(p.entries.f1!.data?.reviewNote).toContain(`approved ${approved}`);
    expect(p.entries.f1!.data?.reviewNote).toContain(`current ${current}`);
    expect(p.summary.reviewQueue).toContainEqual({ id: "f1", held: false, specChanged: true });

    // Approving the template stamps it when no model redrafts.
    const plain = await v1ToV2.plan(v1TreeSource(tree()), { cutAt: CUT, options: { testFiles: TEST_FILES, reviewed: [{ id: "f1", hash: approved }] } });
    expect(plain.entries.f1!.data?.reviewedHash).toBe(approved);
  });

  it("keeps reviewedHash on a re-run with unchanged sources", async () => {
    const approved = specHash((await plan(drafter(GOOD))).entries.f1!.spec!);
    const options = { reviewed: [{ id: "f1", hash: approved }] };
    const first = await plan(drafter(GOOD), { options });
    const again = drafter({ statement: "Something else entirely happens here.", criteria: [] });
    const second = await plan(again, { previous: first, options });
    expect(again).not.toHaveBeenCalled();
    expect(second.entries.f1!.data?.reviewedHash).toBe(approved);
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

  describe("after model placement", () => {
    /** t9 is applied work the rules hold: it shares only one word with f1. */
    const held = (): PRDItem[] => [
      item("e1", "epic", "Planning", [
        item("f1", "feature", "Task selection", [item("t1", "task", "Add priority ordering")]),
        item("f2", "feature", "Folder storage", [item("t2", "task", "Write index files")]),
        item("t9", "task", "Tune selection speed", [], "completed", { acceptanceCriteria: ["Picks a task within 10 ms"] }),
      ]),
    ];
    const CITES_T9: SpecAnswer = {
      statement: "Picks the next actionable task by priority.",
      criteria: [{ text: "The system shall pick a task within 10 ms.", source: "t9" }],
    };
    const JEV_MODEL = "jev-test";
    const judge = () => mockJudge({ place: choiceAnswer("f1", 0.95) });

    function placed(settings: PlacementSettings, tiers: { place?: PlacementModel; judge?: PlacementJudge; draft: SpecModel; previous?: PlanFile }) {
      const seams = planSeams({
        settings,
        spec: { model: MODEL, draft: tiers.draft },
        ...(tiers.place ? { text: { model: MODEL, place: tiers.place } } : {}),
        ...(tiers.judge ? { jev: { model: JEV_MODEL, judge: tiers.judge } } : {}),
        jevAvailable: true,
      });
      return v1ToV2.plan(v1TreeSource(held()), { cutAt: CUT, seams, ...(tiers.previous ? { previous: tiers.previous } : {}), options: { testFiles: [] } });
    }

    const cases: Array<[string, PlacementSettings, () => { place?: PlacementModel; judge?: PlacementJudge }]> = [
      ["the text pass", { models: "text", autoAccept: "agree" }, () => ({ place: vi.fn<PlacementModel>(async () => "f1") })],
      ["the Jev pass, models jev", { models: "jev", autoAccept: "confident" }, () => ({ judge: judge() })],
      ["the Jev pass, models both", { models: "both", autoAccept: "agree" }, () => ({ place: vi.fn<PlacementModel>(async () => "f1"), judge: judge() })],
    ];

    for (const [by, settings, tiers] of cases) {
      it(`an applied change placed by ${by} is in the spec's sources and question, and a criterion citing it is accepted`, async () => {
        const rules = await v1ToV2.plan(v1TreeSource(held()), { cutAt: CUT, options: { testFiles: [] } });
        expect(rules.entries.t9).toMatchObject({ needsPlacement: true, applied: true });
        expect(rules.entries.f1!.spec!.sources).not.toContain("t9");

        const draft = drafter(CITES_T9);
        const p = await placed(settings, { ...tiers(), draft });
        expect(p.entries.t9).toMatchObject({ placement: "f1", modelPlacement: { pass: settings.models === "text" ? "text" : "jev" } });
        const spec = p.entries.f1!.spec!;
        expect(spec.sources).toEqual(["f1", "t1", "t9"]);
        const questions = draft.mock.calls.map(([q]) => q).filter((q) => q.capability.id === "f1");
        expect(questions).toHaveLength(1);
        expect(questions[0]!.history.map((h) => h.id)).toEqual(["t1", "t9"]);
        expect(spec.criteria).toEqual([{ id: "c1", text: "The system shall pick a task within 10 ms.", source: "t9" }]);
        expect(spec.notes.join("\n")).not.toMatch(/rejected/);
      });

      it(`a re-run with unchanged inputs makes no model calls (placed by ${by})`, async () => {
        const first = await placed(settings, { ...tiers(), draft: drafter(CITES_T9) });
        const again = tiers();
        const draft = drafter(CITES_T9);
        const second = await placed(settings, { ...again, draft, previous: first });
        expect(draft).not.toHaveBeenCalled();
        if (again.place) expect(again.place).not.toHaveBeenCalled();
        if (again.judge) expect(again.judge).not.toHaveBeenCalled();
        expect(formatPlanFile(second)).toBe(formatPlanFile(first));
      });
    }
  });

  it("asks placement only when the placement tier includes text, even with a spec drafter", async () => {
    const place = vi.fn<PlacementModel>(async () => null);
    const seams = planSeams({ settings: { models: "jev", autoAccept: "confident" }, text: { model: MODEL, place }, spec: { model: MODEL, draft: drafter(GOOD) } });
    expect(seams.text?.kinds).toEqual(["spec"]);
  });
});
