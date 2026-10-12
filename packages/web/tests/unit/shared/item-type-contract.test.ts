/**
 * `shared/item-type.ts` is a browser-safe mirror of rex's level system, because
 * `src/shared/` is bundled into the viewer and cannot import `@n-dx/rex`. This
 * test is what keeps the mirror honest: it reads rex's own tables and asserts
 * the web copy agrees, so a change to the hierarchy in rex fails here rather
 * than quietly leaving the dashboard validating against yesterday's rules.
 *
 * It also pins the one direction the shim adds: `levelOf`, the v1 level a type
 * is stored as.
 */

import { describe, expect, it } from "vitest";
import { CHILD_LEVEL, LEVEL_HIERARCHY, isWorkItem, isRootLevel, type ItemLevel } from "@n-dx/rex";
import {
  CHILD_TYPE,
  TYPE_PARENTS,
  V1_LEVELS,
  isRootType,
  isWorkItemType,
  itemTypeOf,
  levelOf,
} from "../../../src/shared/item-type.js";

describe("the v1 half mirrors rex", () => {
  it("lists the same levels rex does", () => {
    expect([...V1_LEVELS].sort()).toEqual(Object.keys(LEVEL_HIERARCHY).sort());
  });

  for (const level of ["epic", "feature", "task", "subtask"] as const) {
    it(`agrees with rex about a ${level}'s parents`, () => {
      // The web table may add v2 parents a v1 tree never produces (a task under
      // a change); what it must not do is drop or invent a v1 one.
      const rexParents = LEVEL_HIERARCHY[level];
      const webParents = TYPE_PARENTS[level];
      for (const parent of rexParents) expect(webParents).toContain(parent);
      for (const parent of webParents) {
        if (parent !== null && (V1_LEVELS as readonly string[]).includes(parent)) {
          expect(rexParents).toContain(parent as ItemLevel);
        }
      }
    });

    it(`agrees with rex about a ${level}'s child level`, () => {
      expect(CHILD_TYPE[level]).toBe(CHILD_LEVEL[level]);
    });

    it(`agrees with rex about whether a ${level} is a work item or a root`, () => {
      expect(isWorkItemType(level)).toBe(isWorkItem(level));
      expect(isRootType(level)).toBe(isRootLevel(level));
    });
  }
});

describe("itemTypeOf", () => {
  it("prefers a v2 type", () => {
    expect(itemTypeOf({ type: "change", level: "epic" })).toBe("change");
  });

  it("falls back to a v1 level", () => {
    expect(itemTypeOf({ level: "feature" })).toBe("feature");
  });
});

describe("levelOf", () => {
  it("passes a v1 level through", () => {
    for (const level of V1_LEVELS) expect(levelOf(level)).toBe(level);
  });

  it("stores a root change as an epic and a nested one as a feature", () => {
    expect(levelOf("change")).toBe("epic");
    expect(levelOf("change", "epic")).toBe("feature");
  });

  it("has no v1 level for a product-layer type", () => {
    expect(levelOf("area")).toBeNull();
    expect(levelOf("capability")).toBeNull();
    expect(levelOf("constraint")).toBeNull();
  });
});
