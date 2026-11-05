import { describe, expect, it } from "vitest";
import { itemLinkRefs, linkPatch, normalizeWorkRef, unlinkPatch } from "../../../src/server/tracker/link-refs.js";

describe("normalizeWorkRef", () => {
  it.each([
    ["WM-2054", "WM-2054"],
    ["  WM-2054 ", "WM-2054"],
    ["https://tracker.example/items/9", "https://tracker.example/items/9"],
    ["http://localhost:3000/i/1", "http://localhost:3000/i/1"],
  ])("accepts %s", (input, ref) => expect(normalizeWorkRef(input)).toBe(ref));

  it.each(["", "wm-2054", "owner/repo#12", "#12", "ftp://x.example/1", "https://", "not a ref", 7, null])("refuses %s", (input) => {
    expect(normalizeWorkRef(input)).toBeNull();
  });
});

describe("itemLinkRefs", () => {
  it("reads v2 issues and v1 links by one rule, without repeats", () => {
    expect(itemLinkRefs({
      issues: ["WM-1", 3, "WM-1"],
      links: [{ system: "jira", workItemId: "WM-2" }, { system: "n", workItemId: "x", url: "https://n.example/x" }, { system: "a", workItemId: "opaque" }, "junk", null],
    })).toEqual(["WM-1", "WM-2", "https://n.example/x"]);
  });

  it("reads an item with neither field, or a malformed one, as no links", () => {
    expect(itemLinkRefs({})).toEqual([]);
    expect(itemLinkRefs({ issues: "WM-1", links: {} })).toEqual([]);
  });
});

describe("linkPatch / unlinkPatch", () => {
  it("adds to issues on v2 and to links[] on v1, keeping what is there", () => {
    expect(linkPatch({ issues: ["WM-1"] }, "WM-2", true)).toEqual({ issues: ["WM-1", "WM-2"] });
    expect(linkPatch({}, "https://t.example/1", false)).toEqual({
      links: [{ system: "tracker", workItemId: "https://t.example/1", url: "https://t.example/1" }],
    });
    expect(linkPatch({ links: [{ system: "jira", workItemId: "WM-9" }] }, "WM-2", false)).toEqual({
      links: [{ system: "jira", workItemId: "WM-9" }, { system: "tracker", workItemId: "WM-2" }],
    });
  });

  it("is a no-op for a ref the item already has, whichever field holds it", () => {
    expect(linkPatch({ issues: ["WM-1"] }, "WM-1", true)).toBeNull();
    expect(linkPatch({ links: [{ system: "jira", workItemId: "WM-1" }] }, "WM-1", true)).toBeNull();
  });

  it("removes from the field that holds it, emptying it to undefined", () => {
    expect(unlinkPatch({ issues: ["WM-1", "WM-2"] }, "WM-1")).toEqual({ issues: ["WM-2"] });
    expect(unlinkPatch({ issues: ["WM-1"] }, "WM-1")).toEqual({ issues: undefined });
    expect(unlinkPatch({ links: [{ system: "jira", workItemId: "WM-1" }, { system: "a", workItemId: "opaque" }] }, "WM-1"))
      .toEqual({ links: [{ system: "a", workItemId: "opaque" }] });
    expect(unlinkPatch({ issues: ["WM-1"] }, "WM-2")).toBeNull();
  });
});
