import { describe, it, expect, vi } from "vitest";
import { choiceAnswer, mockJudge } from "../../../helpers/jev-judge.js";
import type { ItemLevel, ItemStatus, PRDItem } from "../../../../src/schema/v1.js";
import type { PlacementJudge, PlacementSettings } from "../../../../src/core/placement-policy.js";
import type { PlacementModel } from "../../../../src/core/placement.js";
import { formatPlanFile } from "../../../../src/migrations/plan-file.js";
import { v1ToV2, v1TreeSource } from "../../../../src/migrations/v1-to-v2/index.js";
import { planSeams } from "../../../../src/migrations/v1-to-v2/seams.js";

function item(id: string, level: ItemLevel, title: string, children: PRDItem[] = [], status: ItemStatus = "completed"): PRDItem {
  return { id, level, title, status, children };
}

/**
 * f1 and f2 are capabilities. t9 shares one word with f1: a clear rules leader
 * too weak for the rules alone, so the rules hold it.
 */
const tree = (): PRDItem[] => [
  item("e1", "epic", "Planning", [
    item("f1", "feature", "Task selection", [item("t1", "task", "Add priority ordering")]),
    item("f2", "feature", "Folder storage", [item("t2", "task", "Write index files")]),
    item("t9", "task", "Tune selection speed", [], "pending"),
  ]),
];

const CUT = "2026-10-08T00:00:00.000Z";
const TEXT_MODEL = "text-test";
const JEV_MODEL = "jev-test";

const textSeam = (answer: Awaited<ReturnType<PlacementModel>>) => vi.fn<PlacementModel>(async () => answer);
/** Jev also reviews the plan when it places (`./jev-review-pass.ts`): its other questions answer with full confidence. */
const judgeSeam = (choice: string, confidence: number) =>
  mockJudge({ place: choiceAnswer(choice, confidence), kind: choiceAnswer("change", 1) });

function plan(settings: PlacementSettings, tiers: { text?: PlacementModel; judge?: PlacementJudge; jevAvailable?: boolean; rulesOnly?: boolean } = {}) {
  const seams = planSeams({
    settings,
    rulesOnly: tiers.rulesOnly,
    ...(tiers.text ? { text: { model: TEXT_MODEL, place: tiers.text } } : {}),
    ...(tiers.judge ? { jev: { model: JEV_MODEL, judge: tiers.judge } } : {}),
    jevAvailable: tiers.jevAvailable ?? true,
  });
  return v1ToV2.plan(v1TreeSource(tree()), { cutAt: CUT, seams, options: { placement: settings } });
}

describe("v1-to-v2 placement passes", () => {
  it("the rules hold t9", async () => {
    const rules = await v1ToV2.plan(v1TreeSource(tree()), { cutAt: CUT });
    expect(rules.entries.t9).toMatchObject({ target: "change", needsPlacement: true });
    expect(rules.entries.t9?.placement).toBeUndefined();
  });

  it("places a held change when the text pick is accepted, recording the pass and model", async () => {
    const text = textSeam("f1");
    const p = await plan({ models: "text", autoAccept: "agree" }, { text });
    expect(text).toHaveBeenCalledTimes(1);
    const t9 = p.entries.t9!;
    expect(t9.placement).toBe("f1");
    expect(t9.needsPlacement).toBeUndefined();
    expect(t9.modelPlacement).toMatchObject({ pass: "text", models: { text: TEXT_MODEL }, used: "text", text: { pick: "f1" } });
    expect(t9.reasons.at(-1)).toContain(`text pass (text ${TEXT_MODEL})`);
    expect(p.header.passes).toEqual([{ name: "rules" }, { name: "text", model: TEXT_MODEL }]);
    expect(p.answers.text?.t9).toMatchObject({ model: TEXT_MODEL, answer: "f1" });
  });

  it("keeps a held change held when the text pick is not accepted", async () => {
    const p = await plan({ models: "text", autoAccept: "none" }, { text: textSeam("f1") });
    expect(p.entries.t9).toMatchObject({ needsPlacement: true, modelPlacement: { accepted: null, text: { pick: "f1" } } });
    expect(p.entries.t9?.placement).toBeUndefined();
  });

  it("a re-plan reuses the recorded text answer and applies the new accept rule", async () => {
    const first = await plan({ models: "text", autoAccept: "none" }, { text: textSeam("f1") });
    const text = textSeam("f2");
    const seams = planSeams({ settings: { models: "text", autoAccept: "agree" }, text: { model: TEXT_MODEL, place: text } });
    const again = await v1ToV2.plan(v1TreeSource(tree()), {
      cutAt: CUT,
      seams,
      previous: first,
      options: { placement: { models: "text", autoAccept: "agree" } },
    });
    expect(text).not.toHaveBeenCalled();
    expect(again.entries.t9?.placement).toBe("f1");
  });

  it("with models jev, the entry carries Jev's pick and confidence; a confident pick is placed", async () => {
    const p = await plan({ models: "jev", autoAccept: "confident" }, { judge: judgeSeam("f1", 0.95) });
    expect(p.entries.t9).toMatchObject({ placement: "f1", modelPlacement: { pass: "jev", models: { jev: JEV_MODEL }, jev: { pick: "f1", confidence: 0.95 } } });
    expect(p.answers.jev?.t9?.answer).toMatchObject({ model: "jev-1.0.0", answers: { place: { choice: "f1" } } });
  });

  it("with models jev, a pick below the confidence threshold stays held with needsPlacement", async () => {
    const p = await plan({ models: "jev", autoAccept: "confident" }, { judge: judgeSeam("f1", 0.5) });
    expect(p.entries.t9).toMatchObject({ needsPlacement: true, modelPlacement: { accepted: null, jev: { pick: "f1", confidence: 0.5 } } });
    expect(p.entries.t9?.placement).toBeUndefined();
  });

  it("with models both, Jev decides with the text answer: agreement places, disagreement holds", async () => {
    const agreed = await plan({ models: "both", autoAccept: "agree" }, { text: textSeam("f1"), judge: judgeSeam("f1", 0.6) });
    expect(agreed.entries.t9).toMatchObject({
      placement: "f1",
      modelPlacement: { pass: "jev", used: "both", models: { text: TEXT_MODEL, jev: JEV_MODEL }, text: { pick: "f1" }, jev: { pick: "f1", confidence: 0.6 } },
    });
    expect(agreed.entries.t9?.parkedTextPlacement).toBeUndefined();

    const split = await plan({ models: "both", autoAccept: "agree" }, { text: textSeam("f2"), judge: judgeSeam("f1", 0.9) });
    expect(split.entries.t9).toMatchObject({ needsPlacement: true, modelPlacement: { accepted: null, jev: { pick: "f1" } } });
  });

  it("never auto-accepts a new-node proposal from the text model", async () => {
    const proposal = { delta: "added", type: "capability", target: "selection-speed", under: "e1", title: "Selection speed", summary: "Fast picks" } as const;
    for (const autoAccept of ["agree", "confident", "none"] as const) {
      const p = await plan({ models: "text", autoAccept }, { text: textSeam({ propose: proposal }) });
      expect(p.entries.t9).toMatchObject({ needsPlacement: true, modelPlacement: { accepted: null, proposal: { title: "Selection speed", under: "e1" } } });
      expect(p.entries.t9?.placement).toBeUndefined();
    }
  });

  it("with no seam available, the plan is the rules-only plan", async () => {
    const rules = formatPlanFile(await v1ToV2.plan(v1TreeSource(tree()), { cutAt: CUT }));
    const text = textSeam("f1");
    const judge = judgeSeam("f1", 0.99);
    const cases = [
      await plan({ models: "text", autoAccept: "agree" }),
      await plan({ models: "text", autoAccept: "agree" }, { text, rulesOnly: true }),
      await plan({ models: "jev", autoAccept: "confident" }, { judge, jevAvailable: false }),
      await plan({ models: "jev", autoAccept: "confident" }, { text }),
    ];
    for (const p of cases) expect(formatPlanFile(p)).toBe(rules);
    expect(text).not.toHaveBeenCalled();
    expect(judge).not.toHaveBeenCalled();
  });

  it("asks only about held changes", async () => {
    const text = textSeam(null);
    await plan({ models: "text", autoAccept: "agree" }, { text });
    expect(text.mock.calls.map(([input]) => input.change.title)).toEqual(["Tune selection speed"]);
  });
});
