import { describe, it, expect } from "vitest";
import {
  detectOverrideAccumulation,
  type OverrideEscalationResult,
} from "../../../src/core/override-escalation.js";
import type { PRDItem } from "../../../src/schema/index.js";

function makeItem(overrides: Partial<PRDItem>): PRDItem {
  return {
    id: `item-${Math.random().toString(36).slice(2, 8)}`,
    title: "Test item",
    status: "pending",
    level: "task",
    ...overrides,
  };
}

describe("detectOverrideAccumulation", () => {
  it("returns empty when no completed tasks exist", () => {
    const items = [makeItem({ status: "pending" })];
    const result = detectOverrideAccumulation(items);
    expect(result.escalations).toHaveLength(0);
  });

  it("returns empty when completed tasks have code-change resolution", () => {
    const items = [
      makeItem({
        status: "completed",
        resolutionType: "code-change",
        tags: ["zone-a"],
      }),
      makeItem({
        status: "completed",
        resolutionType: "code-change",
        tags: ["zone-a"],
      }),
      makeItem({
        status: "completed",
        resolutionType: "code-change",
        tags: ["zone-a"],
      }),
    ];
    const result = detectOverrideAccumulation(items);
    expect(result.escalations).toHaveLength(0);
  });

  it("escalates when 3+ tasks on the same zone are resolved via config-override", () => {
    const items = [
      makeItem({
        status: "completed",
        resolutionType: "config-override",
        tags: ["zone-a"],
      }),
      makeItem({
        status: "completed",
        resolutionType: "config-override",
        tags: ["zone-a"],
      }),
      makeItem({
        status: "completed",
        resolutionType: "config-override",
        tags: ["zone-a"],
      }),
    ];
    const result = detectOverrideAccumulation(items);
    expect(result.escalations).toHaveLength(1);
    expect(result.escalations[0].zone).toBe("zone-a");
    expect(result.escalations[0].overrideCount).toBe(3);
  });

  it("does not escalate when fewer than 3 overrides exist per zone", () => {
    const items = [
      makeItem({
        status: "completed",
        resolutionType: "config-override",
        tags: ["zone-a"],
      }),
      makeItem({
        status: "completed",
        resolutionType: "config-override",
        tags: ["zone-a"],
      }),
    ];
    const result = detectOverrideAccumulation(items);
    expect(result.escalations).toHaveLength(0);
  });

  it("tracks multiple zones independently", () => {
    const items = [
      // zone-a: 3 overrides → escalation
      makeItem({ status: "completed", resolutionType: "config-override", tags: ["zone-a"] }),
      makeItem({ status: "completed", resolutionType: "config-override", tags: ["zone-a"] }),
      makeItem({ status: "completed", resolutionType: "config-override", tags: ["zone-a"] }),
      // zone-b: 2 overrides → no escalation
      makeItem({ status: "completed", resolutionType: "config-override", tags: ["zone-b"] }),
      makeItem({ status: "completed", resolutionType: "config-override", tags: ["zone-b"] }),
    ];
    const result = detectOverrideAccumulation(items);
    expect(result.escalations).toHaveLength(1);
    expect(result.escalations[0].zone).toBe("zone-a");
  });

  it("recurses into children to find completed tasks", () => {
    const parent = makeItem({
      status: "completed",
      level: "feature",
      children: [
        makeItem({ status: "completed", resolutionType: "config-override", tags: ["zone-c"] }),
        makeItem({ status: "completed", resolutionType: "config-override", tags: ["zone-c"] }),
        makeItem({ status: "completed", resolutionType: "config-override", tags: ["zone-c"] }),
      ],
    });
    const result = detectOverrideAccumulation([parent]);
    expect(result.escalations).toHaveLength(1);
    expect(result.escalations[0].zone).toBe("zone-c");
  });

  it("ignores finding: tags (only uses zone-name tags)", () => {
    const items = [
      makeItem({ status: "completed", resolutionType: "config-override", tags: ["zone-a", "finding:abc123"] }),
      makeItem({ status: "completed", resolutionType: "config-override", tags: ["zone-a", "finding:def456"] }),
      makeItem({ status: "completed", resolutionType: "config-override", tags: ["zone-a", "finding:ghi789"] }),
    ];
    const result = detectOverrideAccumulation(items);
    expect(result.escalations).toHaveLength(1);
    expect(result.escalations[0].zone).toBe("zone-a");
  });

  it("provides a human-readable message in the escalation", () => {
    const items = [
      makeItem({ status: "completed", resolutionType: "config-override", tags: ["zone-a"] }),
      makeItem({ status: "completed", resolutionType: "config-override", tags: ["zone-a"] }),
      makeItem({ status: "completed", resolutionType: "config-override", tags: ["zone-a"] }),
      makeItem({ status: "completed", resolutionType: "config-override", tags: ["zone-a"] }),
    ];
    const result = detectOverrideAccumulation(items);
    expect(result.escalations[0].message).toContain("zone-a");
    expect(result.escalations[0].message).toContain("4");
    expect(result.escalations[0].message).toContain("config override");
  });

  it("includes structural-debt tagged items in override count", () => {
    const items = [
      makeItem({ status: "completed", resolutionType: "config-override", tags: ["zone-a", "structural-debt"] }),
      makeItem({ status: "completed", resolutionType: "config-override", tags: ["zone-a", "structural-debt"] }),
      makeItem({ status: "completed", resolutionType: "config-override", tags: ["zone-a"] }),
    ];
    const result = detectOverrideAccumulation(items);
    expect(result.escalations).toHaveLength(1);
  });
});
