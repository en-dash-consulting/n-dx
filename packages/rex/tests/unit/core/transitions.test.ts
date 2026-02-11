import { describe, it, expect } from "vitest";
import { validateTransition, allowedTargets } from "../../../src/core/transitions.js";
import type { ItemStatus } from "../../../src/schema/index.js";

describe("validateTransition", () => {
  // --- No-op (same status) always allowed ---
  it.each<ItemStatus>(["pending", "in_progress", "completed", "failing", "deferred", "blocked", "deleted"])(
    "allows no-op transition: %s → %s",
    (status) => {
      const result = validateTransition(status, status);
      expect(result.allowed).toBe(true);
      expect(result.from).toBe(status);
      expect(result.to).toBe(status);
    },
  );

  // --- Forward progress from pending ---
  it.each<ItemStatus>(["in_progress", "completed", "deferred", "blocked"])(
    "allows pending → %s",
    (to) => {
      expect(validateTransition("pending", to).allowed).toBe(true);
    },
  );

  // --- Forward progress from in_progress ---
  it.each<ItemStatus>(["completed", "failing", "blocked", "deferred", "pending"])(
    "allows in_progress → %s",
    (to) => {
      expect(validateTransition("in_progress", to).allowed).toBe(true);
    },
  );

  // --- Completed allows failing (revert broken work) ---
  it("allows completed → failing", () => {
    expect(validateTransition("completed", "failing").allowed).toBe(true);
  });

  // --- Completed is locked for other transitions ---
  it.each<ItemStatus>(["pending", "in_progress", "deferred", "blocked"])(
    "blocks completed → %s",
    (to) => {
      const result = validateTransition("completed", to);
      expect(result.allowed).toBe(false);
      expect(result.message).toContain("completed");
      expect(result.message).toContain("--force");
    },
  );

  // --- Failing can retry or reset ---
  it.each<ItemStatus>(["in_progress", "pending", "deferred"])(
    "allows failing → %s",
    (to) => {
      expect(validateTransition("failing", to).allowed).toBe(true);
    },
  );

  it.each<ItemStatus>(["completed", "blocked"])(
    "blocks failing → %s",
    (to) => {
      const result = validateTransition("failing", to);
      expect(result.allowed).toBe(false);
      expect(result.message).toContain("--force");
    },
  );

  // --- Deferred can re-activate ---
  it.each<ItemStatus>(["pending", "in_progress", "blocked"])(
    "allows deferred → %s",
    (to) => {
      expect(validateTransition("deferred", to).allowed).toBe(true);
    },
  );

  it("blocks deferred → completed", () => {
    const result = validateTransition("deferred", "completed");
    expect(result.allowed).toBe(false);
    expect(result.message).toContain("--force");
  });

  // --- Blocked can unblock ---
  it.each<ItemStatus>(["pending", "in_progress", "deferred"])(
    "allows blocked → %s",
    (to) => {
      expect(validateTransition("blocked", to).allowed).toBe(true);
    },
  );

  it("blocks blocked → completed", () => {
    const result = validateTransition("blocked", "completed");
    expect(result.allowed).toBe(false);
    expect(result.message).toContain("--force");
  });

  // --- Deletion from any status ---
  it.each<ItemStatus>(["pending", "in_progress", "completed", "failing", "deferred", "blocked"])(
    "allows %s → deleted",
    (from) => {
      expect(validateTransition(from, "deleted").allowed).toBe(true);
    },
  );

  // --- Deleted is terminal ---
  it.each<ItemStatus>(["pending", "in_progress", "completed", "failing", "deferred", "blocked"])(
    "blocks deleted → %s",
    (to) => {
      const result = validateTransition("deleted", to);
      expect(result.allowed).toBe(false);
      expect(result.message).toContain("--force");
    },
  );

  // --- Error messages are clear ---
  it("includes allowed transitions in error message", () => {
    const result = validateTransition("deferred", "completed");
    expect(result.message).toContain("pending");
    expect(result.message).toContain("in_progress");
  });

  it("has a specific message for completed items", () => {
    const result = validateTransition("completed", "pending");
    expect(result.message).toContain("completed");
    expect(result.message).toContain("failing");
  });
});

describe("allowedTargets", () => {
  it("returns valid targets for pending", () => {
    const targets = allowedTargets("pending");
    expect(targets).toContain("in_progress");
    expect(targets).toContain("completed");
    expect(targets).not.toContain("pending");
  });

  it("returns failing and deleted for completed", () => {
    expect(allowedTargets("completed")).toEqual(["failing", "deleted"]);
  });

  it("returns empty array for deleted", () => {
    expect(allowedTargets("deleted")).toEqual([]);
  });

  it("returns valid targets for blocked", () => {
    const targets = allowedTargets("blocked");
    expect(targets).toContain("pending");
    expect(targets).toContain("in_progress");
    expect(targets).not.toContain("completed");
  });
});
