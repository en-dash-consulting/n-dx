/**
 * Import-shape assertions for search-types.ts.
 *
 * Since the module is type-only, these tests verify that the exported
 * types accept the expected shapes and that structural contracts are met.
 */

import { describe, it, expect } from "vitest";
import type {
  SearchFacets,
  SearchItemStatus,
  SearchablePRDItem,
} from "../../../src/viewer/components/prd-tree/search-types.js";

// ── SearchItemStatus ─────────────────────────────────────────────────────────

describe("SearchItemStatus", () => {
  it("covers all seven expected status values", () => {
    const statuses: SearchItemStatus[] = [
      "pending",
      "in_progress",
      "completed",
      "failing",
      "blocked",
      "deferred",
      "deleted",
    ];
    // Type check: all values above must be assignable to SearchItemStatus
    expect(statuses).toHaveLength(7);
  });
});

// ── SearchFacets ─────────────────────────────────────────────────────────────

describe("SearchFacets", () => {
  it("accepts a tags-only configuration", () => {
    const facets: SearchFacets = { tags: new Set(["auth", "api"]) };
    expect(facets.tags?.size).toBe(2);
    expect(facets.statuses).toBeUndefined();
  });

  it("accepts a statuses-only configuration", () => {
    const facets: SearchFacets = {
      statuses: new Set<SearchItemStatus>(["pending", "failing"]),
    };
    expect(facets.statuses?.size).toBe(2);
    expect(facets.tags).toBeUndefined();
  });

  it("accepts combined tags and statuses", () => {
    const facets: SearchFacets = {
      tags: new Set(["frontend"]),
      statuses: new Set<SearchItemStatus>(["in_progress"]),
    };
    expect(facets.tags?.size).toBe(1);
    expect(facets.statuses?.size).toBe(1);
  });

  it("accepts an empty object (both fields optional)", () => {
    const facets: SearchFacets = {};
    expect(facets.tags).toBeUndefined();
    expect(facets.statuses).toBeUndefined();
  });
});

// ── SearchablePRDItem ────────────────────────────────────────────────────────

describe("SearchablePRDItem", () => {
  it("requires id, title, and status", () => {
    const item: SearchablePRDItem = {
      id: "task-1",
      title: "Implement search",
      status: "pending",
    };
    expect(item.id).toBe("task-1");
    expect(item.title).toBe("Implement search");
    expect(item.status).toBe("pending");
  });

  it("accepts optional description, tags, and children", () => {
    const child: SearchablePRDItem = { id: "c1", title: "Child", status: "completed" };
    const item: SearchablePRDItem = {
      id: "t1",
      title: "Parent",
      status: "in_progress",
      description: "Some description",
      tags: ["auth", "backend"],
      children: [child],
    };
    expect(item.description).toBe("Some description");
    expect(item.tags).toHaveLength(2);
    expect(item.children).toHaveLength(1);
    expect(item.children![0].id).toBe("c1");
  });

  it("omits optional fields by default", () => {
    const item: SearchablePRDItem = { id: "x", title: "X", status: "blocked" };
    expect(item.description).toBeUndefined();
    expect(item.tags).toBeUndefined();
    expect(item.children).toBeUndefined();
  });
});
