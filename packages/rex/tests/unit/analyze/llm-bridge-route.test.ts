import { describe, it, expect, beforeEach } from "vitest";
import { resolveConfiguredModel, setLLMConfig } from "../../../src/analyze/llm-bridge.js";
import { resolveVendorModel, TIER_MODELS, resolveModel } from "@n-dx/llm-client";

/**
 * resolveConfiguredModel accepts either a bare weight (legacy) or a task
 * class. The class path resolves through the routing registry, so project
 * `llm.routes` config can reroute a call site without touching code.
 */
describe("resolveConfiguredModel — task-class routing", () => {
  beforeEach(() => {
    setLLMConfig({ vendor: "claude" });
  });

  it("resolves a task class through the registry default", () => {
    expect(resolveConfiguredModel(undefined, { taskClass: "prd.rename" })).toBe(
      resolveVendorModel("claude", {}, "light"),
    );
    expect(resolveConfiguredModel(undefined, { taskClass: "prd.propose" })).toBe(
      resolveVendorModel("claude", {}, "standard"),
    );
  });

  it("honors llm.routes overrides for a class", () => {
    setLLMConfig({ vendor: "claude", routes: { "prd.rename": "heavy" } });
    expect(resolveConfiguredModel(undefined, { taskClass: "prd.rename" })).toBe(
      resolveModel(TIER_MODELS.claude.heavy),
    );
  });

  it("lets an explicit model win over the class route", () => {
    expect(resolveConfiguredModel("claude-opus-5", { taskClass: "prd.rename" })).toBe(
      "claude-opus-5",
    );
  });

  it("keeps legacy bare-weight callers working", () => {
    expect(resolveConfiguredModel(undefined, "light")).toBe(
      resolveVendorModel("claude", {}, "light"),
    );
    expect(resolveConfiguredModel()).toBe(resolveVendorModel("claude", {}, "standard"));
  });
});
