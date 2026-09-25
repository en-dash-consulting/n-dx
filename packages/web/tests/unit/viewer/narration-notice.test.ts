import { describe, expect, it } from "vitest";
import { narrationNotice } from "../../../src/viewer/views/narration-notice.js";

const startedAt = "2026-09-22T18:00:00.000Z";

describe("narrationNotice", () => {
  it("is null when narration is absent or done", () => {
    expect(narrationNotice(undefined)).toBeNull();
    expect(narrationNotice({ status: "done", zones: ["a"], startedAt })).toBeNull();
  });

  it("describes a running narration with its zone count and age", () => {
    const text = narrationNotice({ status: "pending", zones: ["a"], names: ["a", "b"], startedAt }, Date.parse(startedAt) + 3 * 60_000);
    expect(text).toContain("2 zones");
    expect(text).toContain("3 min ago");
  });

  it("describes a failed narration with its reason", () => {
    const text = narrationNotice({ status: "failed", zones: ["a"], startedAt, reason: "superseded by a newer analysis" });
    expect(text).toContain("superseded by a newer analysis");
    expect(text).toContain("sv narrate");
  });
});
