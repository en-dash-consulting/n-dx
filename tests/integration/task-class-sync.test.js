/**
 * Core's task-class list must match llm-client's routing registry.
 *
 * `packages/core/config.js` duplicates `DEFAULT_ROUTES` because
 * orchestration-tier scripts must not import from packages — the same reason
 * `LLM_VENDOR` and the tier/effort sets are declared locally there. A
 * duplicated constant is only safe while something fails when it drifts, and
 * that is this test.
 *
 * Drift is not cosmetic. The copy drives the `--help` listing and the
 * did-you-mean hint, so a class present in the registry but missing here gets
 * reported to the user as "not a task class this build knows about" — advice
 * that is exactly backwards.
 *
 * @see packages/core/config.js — TASK_CLASSES and describeUnknownTaskClass
 * @see packages/llm-client/src/config.ts — DEFAULT_ROUTES
 */

import { describe, it, expect } from "vitest";
import { TASK_CLASSES, nearestTaskClass, describeUnknownTaskClass } from "../../packages/core/config.js";
import { DEFAULT_ROUTES } from "../../packages/llm-client/dist/public.js";

describe("core TASK_CLASSES mirrors llm-client DEFAULT_ROUTES", () => {
  it("covers exactly the same class names", () => {
    expect(Object.keys(TASK_CLASSES).sort()).toEqual(Object.keys(DEFAULT_ROUTES).sort());
  });

  it("agrees on every default tier", () => {
    for (const [taskClass, tier] of Object.entries(DEFAULT_ROUTES)) {
      expect(TASK_CLASSES[taskClass], taskClass).toBe(tier);
    }
  });

  it("reports no known class as unknown", () => {
    // The failure mode drift produces: telling a user their correct class is
    // unrecognized.
    for (const taskClass of Object.keys(DEFAULT_ROUTES)) {
      expect(describeUnknownTaskClass(`routes.${taskClass}`), taskClass).toBeNull();
      expect(describeUnknownTaskClass(`effort.${taskClass}`), taskClass).toBeNull();
    }
  });
});

describe("did-you-mean behaviour", () => {
  it("suggests the intended class for a realistic typo", () => {
    expect(nearestTaskClass("agent.exceute")).toBe("agent.execute");
    expect(nearestTaskClass("prd.renam")).toBe("prd.rename");
    expect(nearestTaskClass("code.classifyy")).toBe("code.classify");
  });

  it("offers nothing for a name that resembles no class", () => {
    // Better silence than pointing someone at an unrelated class.
    expect(nearestTaskClass("something.entirely.different")).toBeNull();
    expect(nearestTaskClass("x")).toBeNull();
  });

  it("stays quiet for glob keys, which are a routing feature", () => {
    expect(describeUnknownTaskClass("routes.prd.*")).toBeNull();
    expect(describeUnknownTaskClass("routes.*")).toBeNull();
    expect(describeUnknownTaskClass("effort.prd.*")).toBeNull();
  });

  it("ignores paths that are not routing keys", () => {
    expect(describeUnknownTaskClass("vendor")).toBeNull();
    expect(describeUnknownTaskClass("tiers.claude.light")).toBeNull();
    expect(describeUnknownTaskClass("model")).toBeNull();
  });

  it("names the suggestion and the help command when it has one", () => {
    const note = describeUnknownTaskClass("routes.agent.exceute");
    expect(note).toContain("agent.execute");
    expect(note).toContain("Setting it anyway");
    expect(note).toContain("ndx config --help");
  });

  it("says the route will not match when it has no suggestion", () => {
    const note = describeUnknownTaskClass("routes.wildly.unrelated.name");
    expect(note).toContain("Setting it anyway");
    expect(note).toMatch(/will not match/);
  });
});
