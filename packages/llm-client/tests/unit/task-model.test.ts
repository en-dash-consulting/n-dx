import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { setCredential } from "../../src/credential-store.js";
import {
  resolveTaskModel,
  resolveVendorModel,
  resolveModel,
  resolveJudgmentRoute,
  configuredJudgmentRoute,
  routesToTier,
  DEFAULT_ROUTES,
  DEFAULT_JUDGMENT_ROUTES,
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

describe("resolveTaskModel — source names the key that supplied the model", () => {
  const cases: Array<[string, LLMConfig, string, string?]> = [
    ["vendor default", { vendor: "claude" }, "vendor-default"],
    ["llm.model", { vendor: "codex", model: "gpt-5.6-luna", codex: { model: "gpt-5.6-terra" } }, "llm.model"],
    ["llm.<vendor>.model", { vendor: "codex", codex: { model: "gpt-5.6-terra" } }, "llm.codex.model"],
    ["llm.tiers.<vendor>.<tier>", { vendor: "claude", model: "sonnet", tiers: { claude: { standard: "opus" } } }, "llm.tiers.claude.standard"],
    ["llm.routes to a catalog tier", { vendor: "claude", routes: { "agent.execute": "heavy" } }, "llm.routes"],
    ["a route that lands on a configured slot", { vendor: "claude", model: "sonnet", routes: { "agent.*": "standard" } }, "llm.model"],
    ["llm.<vendor>.lightModel", { vendor: "google", routes: { "agent.execute": "light" }, google: { lightModel: "gemini-x" } }, "llm.google.lightModel"],
    ["llm.tiers.<vendor>.free", { vendor: "local", routes: { "agent.execute": "free" }, tiers: { local: { free: "qwen" } } }, "llm.tiers.local.free"],
    ["an explicit model", { vendor: "claude", model: "sonnet" }, "explicit", "opus"],
  ];

  it.each(cases)("%s", (_label, config, source, model) => {
    expect(resolveTaskModel("agent.execute", config, model ? { model } : undefined).source).toBe(source);
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

/**
 * resolveJudgmentRoute sits beside resolveTaskModel for calls whose answer
 * is a typed judgment rather than generated text. Its gate is the TypeSafe
 * API key, resolved env first, then the per-user credential store: without
 * a key the helper is inert and every call site keeps using the vendor tier
 * resolveTaskModel picks. Every case names an empty temp ndx home, so the
 * developer's real store never decides a result.
 */
describe("resolveJudgmentRoute", () => {
  let ndxHome: string;
  let withKey: { env: NodeJS.ProcessEnv; ndxHome: string };
  let noKey: { env: NodeJS.ProcessEnv; ndxHome: string };

  beforeEach(() => {
    ndxHome = mkdtempSync(join(tmpdir(), "ndx-judgment-route-"));
    withKey = { env: { TYPESAFE_API_KEY: "tsk_test" }, ndxHome };
    noKey = { env: {}, ndxHome };
  });
  afterEach(() => rmSync(ndxHome, { recursive: true, force: true }));

  it("routes on a key held only in the credential store", () => {
    setCredential("typesafe", "tsk_placeholder_store", { ndxHome });
    expect(resolveJudgmentRoute("code.classify", {}, noKey)).toBe("typesafe");
    expect(resolveJudgmentRoute("prd.assess", {}, noKey)).toBeUndefined();
  });

  it("keeps prd.place.judge and prd.migrate.judge opt-in: neither is a default judgment route", () => {
    for (const cls of ["prd.place.judge", "prd.migrate.judge"]) {
      expect(DEFAULT_JUDGMENT_ROUTES.has(cls), cls).toBe(false);
      expect(resolveJudgmentRoute(cls, {}, withKey), cls).toBeUndefined();
      expect(configuredJudgmentRoute(cls, {}), cls).toBeUndefined();
    }
  });

  it("configuredJudgmentRoute reports the route config asks for without a key", () => {
    expect(configuredJudgmentRoute("code.classify", {})).toBe("typesafe");
    expect(configuredJudgmentRoute("code.classify", { routes: { "*": "light" } })).toBeUndefined();
    expect(configuredJudgmentRoute("prd.assess", { routes: { "prd.assess": "typesafe" } })).toBe("typesafe");
  });

  it("routes a default judgment class to typesafe when the key is present", () => {
    expect(resolveJudgmentRoute("code.classify", {}, withKey)).toBe("typesafe");
    for (const cls of ["code.classify", "finding.judge", "zone.judge"]) {
      expect(DEFAULT_JUDGMENT_ROUTES.has(cls), cls).toBe(true);
      expect(resolveJudgmentRoute(cls, {}, withKey), cls).toBe("typesafe");
    }
  });

  it("returns undefined for every class when the key is absent or blank", () => {
    expect(resolveJudgmentRoute("code.classify", {}, noKey)).toBeUndefined();
    expect(resolveJudgmentRoute("code.classify", {}, { env: { TYPESAFE_API_KEY: "  " }, ndxHome })).toBeUndefined();
    const explicit: LLMConfig = { routes: { "zone.enrich-scan": "typesafe" } };
    expect(resolveJudgmentRoute("zone.enrich-scan", explicit, noKey)).toBeUndefined();
  });

  it("lets llm.routes send a default judgment class back to a tier", () => {
    const config: LLMConfig = { routes: { "code.classify": "light" } };
    expect(resolveJudgmentRoute("code.classify", config, withKey)).toBeUndefined();
  });

  it("lets llm.routes name typesafe explicitly for a class outside the default set", () => {
    const config: LLMConfig = { routes: { "prd.assess": "typesafe" } };
    expect(resolveJudgmentRoute("prd.assess", config, withKey)).toBe("typesafe");
    expect(resolveJudgmentRoute("prd.assess", {}, withKey)).toBeUndefined();
  });

  it("applies the same exact-then-longest-glob matching as resolveTaskModel", () => {
    const config: LLMConfig = { routes: { "code.*": "typesafe", "code.classify": "light" } };
    expect(resolveJudgmentRoute("code.classify", config, withKey)).toBeUndefined();
    expect(resolveJudgmentRoute("code.review", config, withKey)).toBe("typesafe");
    const optOutAll: LLMConfig = { routes: { "*": "standard" } };
    expect(resolveJudgmentRoute("code.classify", optOutAll, withKey)).toBeUndefined();
  });

  it("does not disturb resolveTaskModel: a typesafe route falls through to the registry tier", () => {
    const config: LLMConfig = { vendor: "claude", routes: { "code.classify": "typesafe" } };
    const r = resolveTaskModel("code.classify", config);
    expect(r.tier).toBe(DEFAULT_ROUTES["code.classify"]);
    expect(r.model).toBe(resolveVendorModel("claude", config, DEFAULT_ROUTES["code.classify"]));
  });
});

describe("routesToTier", () => {
  it("is false with no routes, and for a typesafe route", () => {
    expect(routesToTier("prd.migrate.judge", undefined)).toBe(false);
    expect(routesToTier("prd.migrate.judge", {})).toBe(false);
    expect(routesToTier("prd.migrate.judge", { routes: { "prd.migrate.judge": "typesafe" } })).toBe(false);
  });

  it("is true for an exact or glob tier route, exact winning over a glob", () => {
    expect(routesToTier("prd.migrate.judge", { routes: { "prd.migrate.judge": "light" } })).toBe(true);
    expect(routesToTier("prd.migrate.judge", { routes: { "*": "standard" } })).toBe(true);
    expect(routesToTier("prd.migrate.judge", { routes: { "prd.*": "light" } })).toBe(true);
    expect(routesToTier("prd.migrate.judge", { routes: { "*": "standard", "prd.migrate.judge": "typesafe" } })).toBe(false);
    expect(routesToTier("prd.migrate.judge", { routes: { "code.*": "light" } })).toBe(false);
  });
});
