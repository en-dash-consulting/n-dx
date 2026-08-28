import { describe, it, expect } from "vitest";
import {
  resolveTaskModel,
  resolveVendorModel,
  resolveModel,
  DEFAULT_ROUTES,
  TIER_MODELS,
} from "../../src/config.js";
import type { LLMConfig } from "../../src/llm-types.js";

/**
 * resolveTaskModel is the class→tier→model layer: call sites declare what
 * kind of work a call is (a task class), config maps classes to tiers, and
 * the vendor catalog maps tiers to models. These tests pin the resolution
 * precedence, the glob matching rules, and the never-throw fallbacks that
 * make the layer safe to adopt incrementally.
 */

describe("resolveTaskModel — registry defaults", () => {
  it("routes mechanical classes to the light tier by default", () => {
    const r = resolveTaskModel("git.commit-message", { vendor: "claude" });
    expect(r.tier).toBe("light");
    expect(r.model).toBe(resolveVendorModel("claude", {}, "light"));
  });

  it("keeps the agent loop on standard by default", () => {
    const r = resolveTaskModel("agent.execute", { vendor: "claude" });
    expect(r.tier).toBe("standard");
    expect(r.model).toBe(resolveVendorModel("claude", {}, "standard"));
  });

  it("resolves an unknown class to the standard tier rather than throwing", () => {
    const r = resolveTaskModel("not.a.class", { vendor: "claude" });
    expect(r.tier).toBe("standard");
    expect(r.model).toBe(resolveVendorModel("claude", {}, "standard"));
  });

  it("ships a registry entry for every design §04 class family", () => {
    for (const cls of [
      "agent.execute",
      "git.commit-message",
      "context.summarize",
      "context.distill",
      "prd.propose",
      "prd.rename",
      "prd.merge",
      "prd.assess",
      "prd.clarify",
      "prd.spec",
      "prd.smart-add",
      "prd.restructure",
      "prd.decompose",
      "prd.consolidate-check",
      "prd.modify",
      "code.classify",
      "zone.enrich-scan",
      "zone.enrich-deep",
      "zone.meta-eval",
    ]) {
      expect(DEFAULT_ROUTES[cls], cls).toBeDefined();
    }
  });
});

describe("resolveTaskModel — llm.routes precedence", () => {
  it("an exact route overrides the registry default", () => {
    const config: LLMConfig = { vendor: "claude", routes: { "git.commit-message": "standard" } };
    const r = resolveTaskModel("git.commit-message", config);
    expect(r.tier).toBe("standard");
  });

  it("reaches the heavy tier via config with no code change", () => {
    const config: LLMConfig = { vendor: "claude", routes: { "agent.execute": "heavy" } };
    const r = resolveTaskModel("agent.execute", config);
    expect(r.tier).toBe("heavy");
    expect(r.model).toBe(resolveModel(TIER_MODELS.claude.heavy));
  });

  it("matches glob prefixes, with exact matches winning over globs", () => {
    const config: LLMConfig = {
      vendor: "claude",
      routes: { "prd.*": "standard", "prd.rename": "light" },
    };
    expect(resolveTaskModel("prd.merge", config).tier).toBe("standard");
    expect(resolveTaskModel("prd.rename", config).tier).toBe("light");
  });

  it("prefers the longest glob prefix", () => {
    const config: LLMConfig = {
      vendor: "claude",
      routes: { "*": "heavy", "prd.*": "light" },
    };
    expect(resolveTaskModel("prd.rename", config).tier).toBe("light");
    expect(resolveTaskModel("zone.enrich-deep", config).tier).toBe("heavy");
  });

  it("treats an unknown tier name as standard rather than throwing", () => {
    const config: LLMConfig = { vendor: "claude", routes: { "prd.rename": "turbo" } };
    const r = resolveTaskModel("prd.rename", config);
    expect(r.tier).toBe("standard");
  });
});

describe("resolveTaskModel — llm.tiers overrides", () => {
  it("uses the configured tier model over the catalog default", () => {
    const config: LLMConfig = {
      vendor: "claude",
      tiers: { claude: { light: "claude-haiku-4-5-custom" } },
    };
    const r = resolveTaskModel("git.commit-message", config);
    expect(r.model).toBe("claude-haiku-4-5-custom");
    expect(r.tier).toBe("light");
  });

  it("outranks the legacy lightModel slot, which still works without it", () => {
    const both: LLMConfig = {
      vendor: "claude",
      claude: { lightModel: "legacy-light" },
      tiers: { claude: { light: "tiers-light" } },
    };
    expect(resolveTaskModel("prd.rename", both).model).toBe("tiers-light");

    const legacyOnly: LLMConfig = { vendor: "claude", claude: { lightModel: "legacy-light" } };
    expect(resolveTaskModel("prd.rename", legacyOnly).model).toBe(
      resolveVendorModel("claude", legacyOnly, "light"),
    );
  });

  it("ignores tier overrides for other vendors", () => {
    const config: LLMConfig = {
      vendor: "claude",
      tiers: { codex: { light: "gpt-tiny" } },
    };
    expect(resolveTaskModel("git.commit-message", config).model).toBe(
      resolveVendorModel("claude", {}, "light"),
    );
  });
});

describe("resolveTaskModel — the free tier", () => {
  it("falls through to light when no free model is configured", () => {
    const config: LLMConfig = { vendor: "claude", routes: { "git.commit-message": "free" } };
    const r = resolveTaskModel("git.commit-message", config);
    expect(r.tier).toBe("light");
    expect(r.model).toBe(resolveVendorModel("claude", {}, "light"));
  });

  it("uses the configured free model when one exists", () => {
    const config: LLMConfig = {
      vendor: "local",
      routes: { "git.commit-message": "free" },
      tiers: { local: { free: "qwen2.5-coder-14b" } },
    };
    const r = resolveTaskModel("git.commit-message", config);
    expect(r.tier).toBe("free");
    expect(r.model).toBe("qwen2.5-coder-14b");
  });
});

describe("resolveTaskModel — explicit model and vendors", () => {
  it("an explicit model always wins, normalized for the vendor", () => {
    const r = resolveTaskModel("git.commit-message", { vendor: "claude" }, { model: "opus" });
    expect(r.model).toBe(resolveModel("opus"));
    // The routed tier is still reported so run records describe intent.
    expect(r.tier).toBe("light");
  });

  it("collapses every tier to the loaded model for the local vendor", () => {
    const config: LLMConfig = { vendor: "local", routes: { "agent.execute": "heavy" } };
    const r = resolveTaskModel("agent.execute", config);
    expect(r.model).toBe(resolveVendorModel("local", config, "heavy"));
  });

  it("resolves google routes through the google catalog", () => {
    const config: LLMConfig = { vendor: "google", routes: { "prd.propose": "heavy" } };
    expect(resolveTaskModel("prd.propose", config).model).toBe(TIER_MODELS.google.heavy);
  });

  it("honors an explicit vendor override in opts", () => {
    const r = resolveTaskModel("git.commit-message", { vendor: "claude" }, { vendor: "codex" });
    expect(r.model).toBe(TIER_MODELS.codex.light);
  });
});

describe("resolveTaskModel — effort", () => {
  it("matches effort by class with the same exact-then-glob rules", () => {
    const config: LLMConfig = {
      vendor: "claude",
      effort: { "agent.execute": "high", "prd.*": "medium" },
    };
    expect(resolveTaskModel("agent.execute", config).effort).toBe("high");
    expect(resolveTaskModel("prd.rename", config).effort).toBe("medium");
    expect(resolveTaskModel("git.commit-message", config).effort).toBeUndefined();
  });
});
