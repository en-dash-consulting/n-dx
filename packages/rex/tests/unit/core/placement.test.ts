import { describe, it, expect, vi } from "vitest";
import {
  placeChange,
  rankPlacementCandidates,
  type PlacementCapability,
} from "../../../src/core/placement.js";

const caps: PlacementCapability[] = [
  { id: "cap-auth", title: "Token authentication", statement: "Dashboard requests present a per-user token", packages: ["web"], paths: ["src/server/auth"] },
  { id: "cap-store", title: "Folder tree storage", statement: "PRD items persist as folders", packages: ["rex"], realizedBy: ["packages/rex/src/store"] },
  { id: "cap-zones", title: "Zone detection", packages: ["sourcevision"] },
];

describe("rankPlacementCandidates (rules)", () => {
  it("returns a shortlist with no model configured", async () => {
    const result = await placeChange({ title: "Rotate the dashboard token" }, caps);
    expect(result.model).toBeUndefined();
    expect(result.shortlist.map((c) => c.id)).toEqual(["cap-auth"]);
  });

  it("ranks file evidence against realized-by above a word match", () => {
    const ranked = rankPlacementCandidates(
      { title: "Fix token handling", files: ["packages/rex/src/store/lock.ts"] },
      caps,
    );
    expect(ranked[0].id).toBe("cap-store");
    expect(ranked[0].reasons[0]).toMatch(/^file evidence/);
    expect(ranked.map((c) => c.id)).toContain("cap-auth");
  });

  it("fires on package and path mentions", () => {
    const [top] = rankPlacementCandidates({ title: "Harden src/server/auth in web" }, caps);
    expect(top.id).toBe("cap-auth");
    expect(top.reasons).toEqual(expect.arrayContaining(["path: src/server/auth", "package: web"]));
  });

  it("does not treat a package name inside another word as a mention", () => {
    expect(rankPlacementCandidates({ title: "Spider webbing" }, caps)).toEqual([]);
  });

  it("returns nothing when no rule fires, and caps the shortlist", () => {
    expect(rankPlacementCandidates({ title: "Unrelated zebra" }, caps)).toEqual([]);
    const many = Array.from({ length: 9 }, (_, i): PlacementCapability => ({ id: `c${i}`, title: "shared word" }));
    expect(rankPlacementCandidates({ title: "shared word" }, many, 3)).toHaveLength(3);
  });

  it("matches a path fragment on whole segments only", () => {
    const cap: PlacementCapability[] = [{ id: "store", title: "x", paths: ["src/store"] }];
    expect(rankPlacementCandidates({ title: "y", files: ["packages/web/src/store-utils.ts"] }, cap)).toEqual([]);
    expect(rankPlacementCandidates({ title: "y", files: ["packages/rex/src/store/lock.ts"] }, cap)).toHaveLength(1);
  });

  it("ignores an empty package name", () => {
    const cap: PlacementCapability[] = [{ id: "blank", title: "x", packages: [""] }];
    expect(rankPlacementCandidates({ title: "Anything at all" }, cap)).toEqual([]);
  });

  it("breaks ties by id", () => {
    const tied: PlacementCapability[] = [{ id: "b", title: "alpha" }, { id: "a", title: "alpha" }];
    expect(rankPlacementCandidates({ title: "alpha" }, tied).map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("placeChange (rules + text model)", () => {
  const change = { title: "Rotate the dashboard token" };

  it("detects agreement when the model picks the rules' top candidate", async () => {
    const model = vi.fn().mockResolvedValue("cap-auth");
    const result = await placeChange(change, caps, { model });
    expect(result.model).toEqual({ pick: "cap-auth", agrees: true });
    expect(model.mock.calls[0][0].shortlist[0].id).toBe("cap-auth");
  });

  it("detects disagreement, including a pick outside the shortlist and a declined pick", async () => {
    expect((await placeChange(change, caps, { model: async () => "cap-zones" })).model).toEqual({ pick: "cap-zones", agrees: false });
    expect((await placeChange(change, caps, { model: async () => null })).model).toEqual({ pick: null, agrees: false });
  });

  it("never reports agreement when the rules' top score is tied, whichever tied id is picked", async () => {
    const tied: PlacementCapability[] = [{ id: "a", title: "alpha" }, { id: "b", title: "alpha" }];
    for (const pick of ["a", "b"]) {
      expect((await placeChange({ title: "alpha" }, tied, { model: async () => pick })).model?.agrees).toBe(false);
    }
  });

  it("does not call the model when the rules found nothing", async () => {
    const model = vi.fn();
    const result = await placeChange({ title: "Unrelated zebra" }, caps, { model });
    expect(model).not.toHaveBeenCalled();
    expect(result).toEqual({ shortlist: [] });
  });
});
