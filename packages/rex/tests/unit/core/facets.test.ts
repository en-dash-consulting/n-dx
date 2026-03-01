import { describe, it, expect } from "vitest";
import type { PRDItem } from "../../../src/schema/v1.js";
import type { FacetConfig } from "../../../src/core/facets.js";
import {
  isFacetTag,
  parseFacetTag,
  getFacetValue,
  setFacetValue,
  removeFacet,
  getItemFacets,
  getItemsByFacet,
  groupByFacet,
  suggestFacets,
  computeFacetDistribution,
} from "../../../src/core/facets.js";

function makeItem(overrides: Partial<PRDItem> = {}): PRDItem {
  return {
    id: "item-1",
    title: "Test Item",
    status: "pending",
    level: "task",
    ...overrides,
  };
}

describe("isFacetTag", () => {
  it("returns true for valid facet tags", () => {
    expect(isFacetTag("component:auth")).toBe(true);
    expect(isFacetTag("concern:security")).toBe(true);
  });

  it("returns false for plain tags", () => {
    expect(isFacetTag("urgent")).toBe(false);
    expect(isFacetTag("")).toBe(false);
  });

  it("returns false for tags with leading/trailing colon", () => {
    expect(isFacetTag(":value")).toBe(false);
    expect(isFacetTag("key:")).toBe(false);
  });

  it("returns false for tags with multiple colons", () => {
    expect(isFacetTag("a:b:c")).toBe(false);
  });
});

describe("parseFacetTag", () => {
  it("parses a valid facet tag", () => {
    expect(parseFacetTag("component:auth")).toEqual({ key: "component", value: "auth" });
  });

  it("returns null for non-facet tags", () => {
    expect(parseFacetTag("plain")).toBeNull();
    expect(parseFacetTag(":bad")).toBeNull();
    expect(parseFacetTag("bad:")).toBeNull();
    expect(parseFacetTag("a:b:c")).toBeNull();
  });
});

describe("getFacetValue", () => {
  it("returns the value for an existing facet", () => {
    const item = makeItem({ tags: ["component:auth", "urgent"] });
    expect(getFacetValue(item, "component")).toBe("auth");
  });

  it("returns undefined when facet is not set", () => {
    const item = makeItem({ tags: ["urgent"] });
    expect(getFacetValue(item, "component")).toBeUndefined();
  });

  it("returns undefined when tags is undefined", () => {
    const item = makeItem();
    expect(getFacetValue(item, "component")).toBeUndefined();
  });
});

describe("setFacetValue", () => {
  it("creates tags array if missing", () => {
    const item = makeItem();
    setFacetValue(item, "component", "auth");
    expect(item.tags).toEqual(["component:auth"]);
  });

  it("appends facet to existing tags", () => {
    const item = makeItem({ tags: ["urgent"] });
    setFacetValue(item, "component", "auth");
    expect(item.tags).toEqual(["urgent", "component:auth"]);
  });

  it("replaces existing facet value", () => {
    const item = makeItem({ tags: ["component:auth", "urgent"] });
    setFacetValue(item, "component", "dashboard");
    expect(item.tags).toEqual(["component:dashboard", "urgent"]);
  });
});

describe("removeFacet", () => {
  it("removes an existing facet", () => {
    const item = makeItem({ tags: ["component:auth", "urgent"] });
    expect(removeFacet(item, "component")).toBe(true);
    expect(item.tags).toEqual(["urgent"]);
  });

  it("returns false when facet not found", () => {
    const item = makeItem({ tags: ["urgent"] });
    expect(removeFacet(item, "component")).toBe(false);
  });

  it("returns false when tags is undefined", () => {
    const item = makeItem();
    expect(removeFacet(item, "component")).toBe(false);
  });
});

describe("getItemFacets", () => {
  it("extracts all facets as a record", () => {
    const item = makeItem({ tags: ["component:auth", "concern:security", "urgent"] });
    expect(getItemFacets(item)).toEqual({
      component: "auth",
      concern: "security",
    });
  });

  it("returns empty record when no tags", () => {
    expect(getItemFacets(makeItem())).toEqual({});
  });
});

describe("getItemsByFacet", () => {
  it("finds items matching a facet across a tree", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        level: "epic",
        tags: ["component:auth"],
        children: [
          makeItem({ id: "f1", level: "feature", tags: ["component:auth"] }),
          makeItem({ id: "f2", level: "feature", tags: ["component:dashboard"] }),
        ],
      }),
    ];
    const found = getItemsByFacet(items, "component", "auth");
    expect(found.map((i) => i.id)).toEqual(["e1", "f1"]);
  });
});

describe("groupByFacet", () => {
  it("groups items by facet value", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", tags: ["component:auth"] }),
      makeItem({ id: "t2", tags: ["component:auth"] }),
      makeItem({ id: "t3", tags: ["component:dashboard"] }),
      makeItem({ id: "t4" }), // no facet — excluded
    ];
    const groups = groupByFacet(items, "component");
    expect(groups.get("auth")?.map((i) => i.id)).toEqual(["t1", "t2"]);
    expect(groups.get("dashboard")?.map((i) => i.id)).toEqual(["t3"]);
    expect(groups.has("t4")).toBe(false);
  });
});

describe("suggestFacets", () => {
  const config: Record<string, FacetConfig> = {
    component: { label: "Component", values: ["auth", "dashboard", "api"] },
    concern: { label: "Concern", values: ["security", "performance", "ux"] },
  };

  it("suggests based on keyword match in title", () => {
    const item = makeItem({ title: "Fix auth login flow" });
    const suggestions = suggestFacets(item, config);
    expect(suggestions).toContainEqual({
      key: "component",
      value: "auth",
      reason: "keyword match in title/description",
    });
  });

  it("suggests based on keyword match in description", () => {
    const item = makeItem({ title: "Fix issue", description: "The dashboard is broken" });
    const suggestions = suggestFacets(item, config);
    expect(suggestions).toContainEqual({
      key: "component",
      value: "dashboard",
      reason: "keyword match in title/description",
    });
  });

  it("inherits from parent when available", () => {
    const parent = makeItem({ id: "p1", tags: ["component:auth"] });
    const item = makeItem({ title: "Subtask" });
    const suggestions = suggestFacets(item, config, parent);
    expect(suggestions).toContainEqual({
      key: "component",
      value: "auth",
      reason: `inherited from parent "Test Item"`,
    });
  });

  it("skips facets already set on item", () => {
    const item = makeItem({ title: "Fix auth", tags: ["component:api"] });
    const suggestions = suggestFacets(item, config);
    // component is already set, so no component suggestion
    expect(suggestions.find((s) => s.key === "component")).toBeUndefined();
  });
});

describe("computeFacetDistribution", () => {
  it("counts items per facet value", () => {
    const config: Record<string, FacetConfig> = {
      component: { label: "Component", values: ["auth", "dashboard"] },
    };
    const items: PRDItem[] = [
      makeItem({ id: "t1", tags: ["component:auth"] }),
      makeItem({ id: "t2", tags: ["component:auth"] }),
      makeItem({ id: "t3", tags: ["component:dashboard"] }),
    ];
    const dist = computeFacetDistribution(items, config);
    expect(dist.component).toEqual({ auth: 2, dashboard: 1 });
  });
});
