import { describe, it, expect, vi } from "vitest";
import {
  placeChange,
  placementRelation,
  rankPlacementCandidates,
  type PlacementChange,
  type PlacementNode,
  type PlacementProposal,
} from "../../../src/core/placement.js";

const caps: PlacementNode[] = [
  { id: "cap-auth", title: "Token authentication", statement: "Dashboard requests present a per-user token", packages: ["web"], paths: ["src/server/auth"] },
  { id: "cap-store", title: "Folder tree storage", statement: "PRD items persist as folders", packages: ["rex"], realizedBy: ["packages/rex/src/store"] },
  { id: "cap-zones", title: "Zone detection", packages: ["sourcevision"] },
];

describe("rankPlacementCandidates (rules)", () => {
  it("returns a shortlist with no model configured", async () => {
    const result = await placeChange({ title: "Rotate the dashboard token" }, caps);
    expect(result.model).toBeUndefined();
    expect(result.shortlist.map((c) => c.target)).toEqual(["cap-auth"]);
  });

  it("ranks file evidence against realized-by above a word match", () => {
    const ranked = rankPlacementCandidates(
      { title: "Fix token handling", files: ["packages/rex/src/store/lock.ts"] },
      caps,
    );
    expect(ranked[0].target).toBe("cap-store");
    expect(ranked[0].reasons[0]).toMatch(/^file evidence/);
    expect(ranked.map((c) => c.target)).toContain("cap-auth");
  });

  it("fires on package and path mentions", () => {
    const [top] = rankPlacementCandidates({ title: "Harden src/server/auth in web" }, caps);
    expect(top.target).toBe("cap-auth");
    expect(top.reasons).toEqual(expect.arrayContaining(["path: src/server/auth", "package: web"]));
  });

  it("does not treat a package name inside another word as a mention", () => {
    expect(rankPlacementCandidates({ title: "Spider webbing" }, caps)).toEqual([]);
  });

  it("returns nothing when no rule fires, and caps the shortlist", () => {
    expect(rankPlacementCandidates({ title: "Unrelated zebra" }, caps)).toEqual([]);
    const many = Array.from({ length: 9 }, (_, i): PlacementNode => ({ id: `c${i}`, title: "shared word" }));
    expect(rankPlacementCandidates({ title: "shared word" }, many, 3)).toHaveLength(3);
  });

  it("matches a path fragment on whole segments only", () => {
    const cap: PlacementNode[] = [{ id: "store", title: "x", paths: ["src/store"] }];
    expect(rankPlacementCandidates({ title: "y", files: ["packages/web/src/store-utils.ts"] }, cap)).toEqual([]);
    expect(rankPlacementCandidates({ title: "y", files: ["packages/rex/src/store/lock.ts"] }, cap)).toHaveLength(1);
  });

  it("ignores an empty package name", () => {
    const cap: PlacementNode[] = [{ id: "blank", title: "x", packages: [""] }];
    expect(rankPlacementCandidates({ title: "Anything at all" }, cap)).toEqual([]);
  });

  it("breaks ties by id", () => {
    const tied: PlacementNode[] = [{ id: "b", title: "alpha" }, { id: "a", title: "alpha" }];
    expect(rankPlacementCandidates({ title: "alpha" }, tied).map((c) => c.target)).toEqual(["a", "b"]);
  });
});

describe("placementRelation (rules decide the relation)", () => {
  const amends = "Relation: amends";

  it("a fix touches, even when its title and intent ask for something new", () => {
    expect(placementRelation({ title: "Add the missing lock check", intent: amends, fix: true })).toBe("touches");
  });

  it("an amending title verb places as amends without a marker", () => {
    expect(placementRelation({ title: "Add Jira import" })).toBe("amends");
    expect(placementRelation({ title: "  allow token rotation", intent: "A new store layout" })).toBe("amends");
  });

  it("a title without an amending verb touches, and intent prose never decides", () => {
    expect(placementRelation({ title: "Token rotation" })).toBe("touches");
    expect(placementRelation({ title: "Do not add retries to the hub" })).toBe("touches");
    expect(placementRelation({ title: "Rename the lock helper", intent: "the new store layout makes the old name misleading" })).toBe("touches");
    expect(placementRelation({ title: "Rename the lock helper", intent: "Allow a new store layout; adds a support file" })).toBe("touches");
  });

  it("an explicit Relation line wins in either direction", () => {
    expect(placementRelation({ title: "Rename the lock helper", intent: amends })).toBe("amends");
    expect(placementRelation({ title: "Token rotation", intent: `Rotate tokens.\n${amends}` })).toBe("amends");
    expect(placementRelation({ title: "Add a retry", intent: "Relation: touches" })).toBe("touches");
    expect(placementRelation({ title: "Add a retry", intent: "  relation : TOUCHES" })).toBe("touches");
  });

  it("a code-health finding touches", () => {
    expect(placementRelation({ title: "Add a gateway for web imports", intent: amends, tags: ["code-health"] })).toBe("touches");
  });

  it("every ranked candidate carries the rules' relation", () => {
    const ranked = rankPlacementCandidates(
      { title: "Add rex folder storage export", intent: amends, files: ["packages/rex/src/store/x.ts"] },
      caps,
    );
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.every((c) => c.relation === "amends")).toBe(true);
  });
});

describe("constraints as placement candidates", () => {
  const nodes: PlacementNode[] = [
    ...caps,
    { id: "k-arch", type: "constraint", title: "Architecture integrity", statement: "Tiers, gateways, spawn-only, zero cycles" },
    { id: "k-perf", type: "constraint", title: "Fast startup", statement: "The CLI starts in under a second", packages: ["web"] },
  ];

  it("ranks a constraint on the same rules as a capability", () => {
    const [top] = rankPlacementCandidates({ title: "Speed up web startup" }, nodes);
    expect(top).toMatchObject({ target: "k-perf", relation: "touches" });
  });

  it("puts a code-health finding on the architecture constraint, as touches", () => {
    const finding = { title: "Fix coupling in web-viewer zone", tags: ["code-health"] };
    const [top] = rankPlacementCandidates(finding, nodes);
    expect(top).toMatchObject({ target: "k-arch", relation: "touches" });
    expect(top.reasons).toContain("code-health finding: architecture constraint");
  });

  it("finds the architecture constraint by tag as well as title", () => {
    const tagged: PlacementNode[] = [{ id: "k-tiers", type: "constraint", title: "Tier layering", tags: ["architecture"] }];
    expect(rankPlacementCandidates({ title: "Fix cycle", tags: ["code-health"] }, tagged).map((c) => c.target)).toEqual(["k-tiers"]);
  });

  it("does not give a capability named architecture, or a non-finding change, the code-health boost", () => {
    const capNamed: PlacementNode[] = [{ id: "cap-arch", title: "Architecture map" }];
    expect(rankPlacementCandidates({ title: "Fix cycle", tags: ["code-health"] }, capNamed)).toEqual([]);
    expect(rankPlacementCandidates({ title: "Fix cycle" }, nodes)).toEqual([]);
  });

  it("ignores where a change came from: only the code-health tag boosts the architecture constraint", () => {
    const fromSourcevision = { title: "Fix cycle", source: "sourcevision" } as PlacementChange;
    expect(rankPlacementCandidates(fromSourcevision, nodes)).toEqual([]);
  });
});

describe("placeChange (rules + text model)", () => {
  const change = { title: "Rotate the dashboard token" };

  it("detects agreement when the model picks the rules' top candidate", async () => {
    const model = vi.fn().mockResolvedValue("cap-auth");
    const result = await placeChange(change, caps, { model });
    expect(result.model).toEqual({ pick: "cap-auth", agrees: true });
    expect(model.mock.calls[0][0].shortlist[0].target).toBe("cap-auth");
  });

  it("detects disagreement, including a pick outside the shortlist and a declined pick", async () => {
    expect((await placeChange(change, caps, { model: async () => "cap-zones" })).model).toEqual({ pick: "cap-zones", agrees: false });
    expect((await placeChange(change, caps, { model: async () => null })).model).toEqual({ pick: null, agrees: false });
  });

  it("never reports agreement when the rules' top score is tied, whichever tied id is picked", async () => {
    const tied: PlacementNode[] = [{ id: "a", title: "alpha" }, { id: "b", title: "alpha" }];
    for (const pick of ["a", "b"]) {
      expect((await placeChange({ title: "alpha" }, tied, { model: async () => pick })).model?.agrees).toBe(false);
    }
  });

  const areas = [{ id: "area-dashboard", title: "Dashboard" }];

  it("asks the model when the rules found nothing, passing the areas; a pick is never agreement", async () => {
    const model = vi.fn().mockResolvedValue("cap-auth");
    const result = await placeChange({ title: "Unrelated zebra" }, caps, { model, areas });
    expect(model).toHaveBeenCalledTimes(1);
    expect(model.mock.calls[0][0]).toMatchObject({ shortlist: [], areas });
    expect(result.model).toEqual({ pick: "cap-auth", agrees: false });
  });

  it("passes no areas as an empty list and never calls without a model", async () => {
    const model = vi.fn().mockResolvedValue(null);
    await placeChange({ title: "Unrelated zebra" }, caps, { model });
    expect(model.mock.calls[0][0].areas).toEqual([]);
    expect(await placeChange({ title: "Unrelated zebra" }, caps)).toEqual({ shortlist: [], warnings: [] });
  });

  const proposal: PlacementProposal = {
    target: "cap-token-rotation",
    delta: "added",
    type: "capability",
    under: "area-dashboard",
    title: "Token rotation",
    summary: "Users rotate their dashboard token",
  };

  it("reports a well-formed new-node proposal as no pick and no agreement", async () => {
    const result = await placeChange(change, caps, { model: async () => ({ propose: proposal }), areas });
    expect(result.model).toEqual({ pick: null, agrees: false, proposal });
    expect(result.warnings).toEqual([]);
  });

  it("keeps a proposal for an unmatched change, and drops one whose area is unknown", async () => {
    const unmatched = { title: "Unrelated zebra" };
    const kept = await placeChange(unmatched, caps, { model: async () => ({ propose: proposal }), areas });
    expect(kept.shortlist).toEqual([]);
    expect(kept.model).toEqual({ pick: null, agrees: false, proposal });
    const dropped = await placeChange(unmatched, caps, { model: async () => ({ propose: { ...proposal, under: "area-nowhere" } }), areas });
    expect(dropped.model).toEqual({ pick: null, agrees: false });
    expect(dropped.warnings.join()).toMatch(/"area-nowhere", which is not a known area/);
    const noAreas = await placeChange(unmatched, caps, { model: async () => ({ propose: proposal }) });
    expect(noAreas.model).toEqual({ pick: null, agrees: false });
  });

  it.each([
    ["a modified delta", { ...proposal, delta: "modified" }],
    ["no type", { ...proposal, type: undefined }],
    ["an unknown type", { ...proposal, type: "area" }],
    ["no area", { ...proposal, under: " " }],
    ["no title", { ...proposal, title: "" }],
    ["a non-string proposed and a null criteria.add", { ...proposal, proposed: 42, criteria: { add: null } }],
    ["a non-string summary", { ...proposal, summary: 7 }],
    ["no target", { ...proposal, target: "" }],
  ])("drops a proposal with %s, with a warning", async (_n, bad) => {
    const result = await placeChange(change, caps, { model: async () => ({ propose: bad as PlacementProposal }), areas });
    expect(result.model).toEqual({ pick: null, agrees: false });
    expect(result.warnings.join()).toMatch(/proposed a new node/);
  });
});
