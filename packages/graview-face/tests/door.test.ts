/**
 * The door's gate, headless: what it lets through and what it refuses
 * before anything reaches rex.
 */
import { describe, expect, it } from "vitest";
import { ALLOWED_TOOLS, isOwnRequest } from "../dev/ndx-door.js";

describe("the door", () => {
  it("passes only the four tools the sync loop uses", () => {
    expect([...ALLOWED_TOOLS].sort()).toEqual(["append_log", "edit_item", "get_item", "update_task_status"]);
    for (const tool of ["merge_items", "move_item", "reorganize", "add_item", "apply_change", "place_change"]) expect(ALLOWED_TOOLS.has(tool), tool).toBe(false);
  });

  it("takes a request from its own pages, or with no browser headers at all", () => {
    expect(isOwnRequest({}, "localhost:5188")).toBe(true);
    expect(isOwnRequest({ origin: "http://localhost:5188", "sec-fetch-site": "same-origin" }, "localhost:5188")).toBe(true);
    expect(isOwnRequest({ "sec-fetch-site": "none" }, "localhost:5188")).toBe(true);
  });

  it("refuses another origin, with or without a fetch-metadata header", () => {
    expect(isOwnRequest({ origin: "https://evil.example", "sec-fetch-site": "cross-site" }, "localhost:5188")).toBe(false);
    expect(isOwnRequest({ origin: "https://evil.example" }, "localhost:5188")).toBe(false);
    expect(isOwnRequest({ origin: "http://localhost:5188", "sec-fetch-site": "cross-site" }, "localhost:5188")).toBe(false);
    expect(isOwnRequest({ origin: "not a url" }, "localhost:5188")).toBe(false);
    expect(isOwnRequest({ origin: "http://localhost:5188" }, undefined)).toBe(false);
  });
});
