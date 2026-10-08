import { describe, it, expect, vi } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JevResponse } from "@n-dx/llm-client";
import {
  decidePlacement,
  loadPlacementSettings,
  parsePlacementSettings,
  PLACEMENT_JEV_MIN_CONFIDENCE,
  PLACEMENT_JUDGE_TASK_CLASS,
  PLACEMENT_NONE_OF_THESE,
  type PlacementAutoAccept,
  type PlacementJudge,
  type PlacementModels,
} from "../../../src/core/placement-policy.js";
import type { PlacementModel, PlacementNode, PlacementProposal } from "../../../src/core/placement.js";

const caps: PlacementNode[] = [
  { id: "cap-store", title: "Folder tree storage", statement: "PRD items persist as folders", packages: ["rex"], realizedBy: ["packages/rex/src/store"] },
  { id: "cap-auth", title: "Token authentication", statement: "Requests present a token", packages: ["web"] },
];
// Rules: cap-store clearly leads (file evidence); cap-auth is on the shortlist via a package mention.
const change = { title: "Fix lock in rex for web token", files: ["packages/rex/src/store/lock.ts"], fix: true };
/** The rules make every placement of `change` (a fix) a touch. */
const at = (target: string) => ({ target, relation: "touches" });

const text = (pick: string | null): PlacementModel => vi.fn(async () => pick);
const jev = (pick: string, confidence: number): PlacementJudge =>
  vi.fn(async (): Promise<JevResponse> => ({
    model: "jev-test",
    answers: {
      place: {
        type: "choice",
        choice: pick,
        confidence,
        probabilities: { "cap-store": pick === "cap-store" ? 0.9 : 0.1, "cap-auth": pick === "cap-auth" ? 0.9 : 0.1 },
      },
    },
  }));

const run = (models: PlacementModels, autoAccept: PlacementAutoAccept, o: { text?: string | null; jev?: [string, number] }) =>
  decidePlacement(change, caps, {
    settings: { models, autoAccept },
    model: text(o.text ?? null),
    judge: o.jev ? jev(...o.jev) : undefined,
  });

describe("decidePlacement: models x autoAccept", () => {
  it("rules rank cap-store first", async () => {
    const d = await run("text", "none", { text: "cap-store" });
    expect(d.shortlist.map((c) => c.target)).toEqual(["cap-store", "cap-auth"]);
  });

  describe.each(["text", "jev", "both"] as const)("models=%s", (models) => {
    it("none never accepts", async () => {
      const d = await run(models, "none", { text: "cap-store", jev: ["cap-store", 0.99] });
      expect(d.accepted).toBeNull();
      expect(d.needsPlacement).toBe(true);
    });
  });

  describe("agree", () => {
    it("text: accepts when the text model picks the rules top", async () => {
      const d = await run("text", "agree", { text: "cap-store" });
      expect(d).toMatchObject({ accepted: at("cap-store"), needsPlacement: false });
    });
    it("text: leaves it open when the model disagrees", async () => {
      const d = await run("text", "agree", { text: "cap-auth" });
      expect(d).toMatchObject({ accepted: null, needsPlacement: true });
    });
    it("jev: accepts when Jev picks the rules top, without calling the text model", async () => {
      const model = text("cap-store");
      const d = await decidePlacement(change, caps, { settings: { models: "jev", autoAccept: "agree" }, model, judge: jev("cap-store", 0.1) });
      expect(d.accepted).toEqual(at("cap-store"));
      expect(model).not.toHaveBeenCalled();
    });
    it("jev: leaves it open when Jev disagrees", async () => {
      const d = await run("jev", "agree", { jev: ["cap-auth", 0.99] });
      expect(d.needsPlacement).toBe(true);
    });
    it("both: needs rules top, text model and Jev to all agree", async () => {
      expect((await run("both", "agree", { text: "cap-store", jev: ["cap-store", 0.1] })).accepted).toEqual(at("cap-store"));
      expect((await run("both", "agree", { text: "cap-auth", jev: ["cap-store", 0.1] })).accepted).toBeNull();
      expect((await run("both", "agree", { text: "cap-store", jev: ["cap-auth", 0.1] })).accepted).toBeNull();
    });
  });

  describe("confident", () => {
    it("text: never accepts and warns that confident needs Jev", async () => {
      const d = await run("text", "confident", { text: "cap-store" });
      expect(d.accepted).toBeNull();
      expect(d.warnings.join()).toMatch(/needs Jev/);
    });
    it.each(["jev", "both"] as const)("%s: accepts a Jev pick at the confidence threshold, even off the rules top", async (models) => {
      const d = await run(models, "confident", { text: "cap-store", jev: ["cap-auth", PLACEMENT_JEV_MIN_CONFIDENCE] });
      expect(d.accepted).toEqual(at("cap-auth"));
    });
    it.each(["jev", "both"] as const)("%s: leaves a low-confidence Jev pick open", async (models) => {
      const d = await run(models, "confident", { text: "cap-store", jev: ["cap-store", PLACEMENT_JEV_MIN_CONFIDENCE - 0.01] });
      expect(d.needsPlacement).toBe(true);
    });
    it("rejects a Jev pick that is not on the shortlist", async () => {
      const d = await run("jev", "confident", { jev: ["cap-unknown", 0.99] });
      expect(d.accepted).toBeNull();
    });
  });
});

describe("decidePlacement: Jev abstain and confidence validation", () => {
  it.each(["jev", "both"] as const)("%s: none-of-these is never accepted in any mode and leaves needsPlacement set", async (models) => {
    for (const autoAccept of ["none", "agree", "confident"] as const) {
      const d = await run(models, autoAccept, { text: "cap-store", jev: [PLACEMENT_NONE_OF_THESE, 0.95] });
      expect(d).toMatchObject({ accepted: null, needsPlacement: true });
      expect(d.jev).toMatchObject({ abstained: true, pick: null });
      expect(d.warnings.join()).toMatch(/Jev abstained/);
    }
  });
  it("offers none-of-these as a choice option that no capability id can equal", async () => {
    const judge = jev("cap-store", 0.9);
    await decidePlacement(change, caps, { settings: { models: "jev", autoAccept: "none" }, judge });
    const [request] = (judge as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(Object.keys(request.questions.place.criteria)).toContain(PLACEMENT_NONE_OF_THESE);
  });
  it.each([1.4, -0.1, NaN, Infinity])("rejects confidence %s with a warning", async (confidence) => {
    const d = await run("jev", "confident", { jev: ["cap-store", confidence] });
    expect(d).toMatchObject({ accepted: null, needsPlacement: true });
    expect(d.warnings.join()).toMatch(/confidence/);
  });
  it.each(["jev", "both"] as const)("%s: still accepts a valid 0.85 on-shortlist pick", async (models) => {
    const d = await run(models, "confident", { text: "cap-store", jev: ["cap-auth", 0.85] });
    expect(d.accepted).toEqual(at("cap-auth"));
    expect(d.warnings).toEqual([]);
  });
});

describe("decidePlacement: Jev request and ranking", () => {
  it("asks one choice question under prd.place.judge with the shortlist as criteria, and ranks by probability", async () => {
    const judge = jev("cap-auth", 0.5);
    const d = await decidePlacement(change, caps, { settings: { models: "jev", autoAccept: "none" }, judge });
    const [request, opts] = (judge as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(opts).toEqual({ taskClass: PLACEMENT_JUDGE_TASK_CLASS });
    expect(Object.keys(request.questions)).toEqual(["place"]);
    expect(request.questions.place).toMatchObject({
      type: "choice",
      criteria: { "cap-store": "PRD items persist as folders", "cap-auth": "Requests present a token" },
    });
    expect(request.state.change.title).toBe(change.title);
    expect(d.jev?.ranking).toEqual([
      { ...at("cap-auth"), probability: 0.9 },
      { ...at("cap-store"), probability: 0.1 },
    ]);
  });
});

describe("decidePlacement: degradation", () => {
  it.each([
    ["flag", { jevAvailable: false, judge: jev("cap-store", 0.99) }],
    ["absent seam", {}],
  ])("both degrades to text with a warning (%s)", async (_n, extra) => {
    const model = text("cap-store");
    const d = await decidePlacement(change, caps, { settings: { models: "both", autoAccept: "agree" }, model, ...extra });
    expect(d).toMatchObject({ used: "text", accepted: at("cap-store") });
    expect(d.warnings.join()).toMatch(/Jev is unavailable/);
    expect(model).toHaveBeenCalledOnce();
  });

  it("jev degrades to rules only with a warning and never calls the text model", async () => {
    const model = text("cap-store");
    const d = await decidePlacement(change, caps, { settings: { models: "jev", autoAccept: "agree" }, model, jevAvailable: false });
    expect(d).toMatchObject({ used: "rules", accepted: null, needsPlacement: true });
    expect(d.warnings.join()).toMatch(/rules only/);
    expect(model).not.toHaveBeenCalled();
  });

  it("a change nothing matches carries needsPlacement and calls no model", async () => {
    const model = text("cap-store");
    const d = await decidePlacement({ title: "Unrelated" }, caps, { model });
    expect(d).toMatchObject({ shortlist: [], accepted: null, needsPlacement: true });
    expect(model).not.toHaveBeenCalled();
  });

  it("defaults are text + agree", async () => {
    const d = await decidePlacement(change, caps, { model: text("cap-store") });
    expect(d.accepted).toEqual(at("cap-store"));
  });
});

describe("decidePlacement: target and relation", () => {
  const feature = { title: "Add folder export to rex", files: ["packages/rex/src/store/export.ts"] };

  it("accepts { target, relation } with the rules' relation: a new-behaviour change amends", async () => {
    const d = await decidePlacement(feature, caps, { settings: { models: "both", autoAccept: "agree" }, model: text("cap-store"), judge: jev("cap-store", 0.9) });
    expect(d.relation).toBe("amends");
    expect(d.accepted).toEqual({ target: "cap-store", relation: "amends" });
    expect(d.shortlist.every((c) => c.relation === "amends")).toBe(true);
    expect(d.jev?.ranking.every((r) => r.relation === "amends")).toBe(true);
  });

  it("a fix touches; a confident Jev pick takes the rules' relation, not its own", async () => {
    const d = await run("jev", "confident", { jev: ["cap-auth", 0.95] });
    expect(d.relation).toBe("touches");
    expect(d.accepted).toEqual({ target: "cap-auth", relation: "touches" });
  });

  it("places a code-health finding on the architecture constraint as touches", async () => {
    const nodes: PlacementNode[] = [...caps, { id: "k-arch", type: "constraint", title: "Architecture integrity" }];
    const finding = { title: "Fix cycle between viewer and server", source: "sourcevision" };
    const d = await decidePlacement(finding, nodes, { settings: { models: "text", autoAccept: "agree" }, model: text("k-arch") });
    expect(d.shortlist[0].target).toBe("k-arch");
    expect(d.accepted).toEqual({ target: "k-arch", relation: "touches" });
  });
});

describe("decidePlacement: a proposed new node is never auto-accepted", () => {
  const proposal: PlacementProposal = {
    target: "cap-lock-audit",
    delta: "added",
    type: "capability",
    under: "area-storage",
    title: "Lock audit",
    summary: "Record who holds the PRD lock",
  };
  const proposer: PlacementModel = vi.fn(async () => ({ propose: proposal }));

  it.each(["text", "both"] as const)("%s: in every autoAccept mode, even with a confident Jev pick", async (models) => {
    for (const autoAccept of ["none", "agree", "confident"] as const) {
      const d = await decidePlacement(change, caps, { settings: { models, autoAccept }, model: proposer, judge: jev("cap-store", 0.99) });
      expect(d).toMatchObject({ accepted: null, needsPlacement: true, proposal });
      expect(d.warnings.join()).toMatch(/proposed a new capability "Lock audit" under "area-storage"/);
    }
  });

  it("surfaces a malformed proposal as a warning and no proposal", async () => {
    const bad: PlacementModel = async () => ({ propose: { ...proposal, type: undefined } as unknown as PlacementProposal });
    const d = await decidePlacement(change, caps, { settings: { models: "text", autoAccept: "agree" }, model: bad });
    expect(d.proposal).toBeUndefined();
    expect(d).toMatchObject({ accepted: null, needsPlacement: true });
    expect(d.warnings.join()).toMatch(/not an added amendment/);
  });
});

describe("placement settings", () => {
  it("defaults, valid values and invalid values", () => {
    expect(parsePlacementSettings({})).toEqual({ settings: { models: "text", autoAccept: "agree" }, warnings: [] });
    expect(parsePlacementSettings({ placement: { models: "both", autoAccept: "confident" } }).settings).toEqual({
      models: "both",
      autoAccept: "confident",
    });
    const bad = parsePlacementSettings({ placement: { models: "gpt", autoAccept: 3 } });
    expect(bad.settings).toEqual({ models: "text", autoAccept: "agree" });
    expect(bad.warnings).toHaveLength(2);
  });

  it("loads from .n-dx.json beside the .rex directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "placement-"));
    await mkdir(join(root, ".rex"));
    await writeFile(join(root, ".n-dx.json"), JSON.stringify({ rex: { placement: { models: "jev", autoAccept: "none" } } }));
    expect((await loadPlacementSettings(join(root, ".rex"))).settings).toEqual({ models: "jev", autoAccept: "none" });
  });
});
