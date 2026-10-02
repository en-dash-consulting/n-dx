/**
 * Which setting chose the reviewer's model — the precedence of
 * `resolveReviewModel`, answered as a name, so the run record can say it.
 */
import { describe, it, expect } from "vitest";
import { reviewModelSource } from "../../../src/agent/analysis/adversarial-review.js";

describe("reviewModelSource", () => {
  it("is the flag when --review-model was passed, whatever the config says", () => {
    expect(reviewModelSource("claude", { reviewModel: "a", claude: { reviewModel: "b" } }, "c")).toBe("flag");
  });

  it("is the vendor-pinned setting before the shared one", () => {
    expect(reviewModelSource("claude", { reviewModel: "a", claude: { reviewModel: "b" } }, undefined)).toBe("vendor-config");
    expect(reviewModelSource("codex", { reviewModel: "a", claude: { reviewModel: "b" } }, undefined)).toBe("shared-config");
  });

  it("is the vendor default when nothing names a model", () => {
    expect(reviewModelSource("claude", undefined, undefined)).toBe("vendor-default");
    expect(reviewModelSource("local", { local: {} }, undefined)).toBe("vendor-default");
  });
});
