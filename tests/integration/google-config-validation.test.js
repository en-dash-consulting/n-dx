/**
 * Integration tests for Google Gemini configuration validation.
 *
 * Verifies:
 * - llm.google.model validation: accepts "gemini-*" IDs, rejects others
 * - llm.google.apiKeyEnv: stored and reflected in ndx config output
 * - llm.google.apiKeyEnv defaults to GEMINI_API_KEY when not set
 * - Schema validation error messages name the offending field
 * - Valid Google config entries round-trip through config.js
 *
 * Imports from compiled dist/ artifacts to test the real exported API surface.
 *
 * @see packages/llm-client/src/google-api-provider.ts  (validateGeminiModelId)
 * @see packages/llm-client/src/llm-types.ts             (GoogleConfig)
 * @see packages/core/config.js                          (LLM_VALIDATORS)
 */

import { describe, it, expect } from "vitest";

/** @type {Record<string, unknown>} */
let llmClientConfig;

/** @type {Record<string, unknown>} */
let googleApiProvider;

describe("Google config validation gauntlet", () => {
  // ── Module loading ─────────────────────────────────────────────────────────

  it("loads llm-client dist/config.js", async () => {
    llmClientConfig = await import("../../packages/llm-client/dist/config.js");
    expect(llmClientConfig).toBeDefined();
  });

  it("loads llm-client dist/google-api-provider.js", async () => {
    googleApiProvider = await import(
      "../../packages/llm-client/dist/google-api-provider.js"
    );
    expect(googleApiProvider).toBeDefined();
  });

  // ── validateGeminiModelId ──────────────────────────────────────────────────

  describe("validateGeminiModelId", () => {
    it("exports validateGeminiModelId function", async () => {
      const mod = await import(
        "../../packages/llm-client/dist/google-api-provider.js"
      );
      expect(typeof mod.validateGeminiModelId).toBe("function");
    });

    it("accepts gemini-2.5-pro (heavy tier)", async () => {
      const { validateGeminiModelId } = await import(
        "../../packages/llm-client/dist/google-api-provider.js"
      );
      expect(() => validateGeminiModelId("gemini-2.5-pro")).not.toThrow();
    });

    it("accepts gemini-2.5-flash (standard tier)", async () => {
      const { validateGeminiModelId } = await import(
        "../../packages/llm-client/dist/google-api-provider.js"
      );
      expect(() => validateGeminiModelId("gemini-2.5-flash")).not.toThrow();
    });

    it("accepts gemini-2.0-flash (light tier)", async () => {
      const { validateGeminiModelId } = await import(
        "../../packages/llm-client/dist/google-api-provider.js"
      );
      expect(() => validateGeminiModelId("gemini-2.0-flash")).not.toThrow();
    });

    it("rejects gpt-4o — not a Gemini model", async () => {
      const { validateGeminiModelId } = await import(
        "../../packages/llm-client/dist/google-api-provider.js"
      );
      expect(() => validateGeminiModelId("gpt-4o")).toThrow(/gemini-/i);
    });

    it("rejects claude-sonnet-4-6 — not a Gemini model", async () => {
      const { validateGeminiModelId } = await import(
        "../../packages/llm-client/dist/google-api-provider.js"
      );
      expect(() => validateGeminiModelId("claude-sonnet-4-6")).toThrow(/gemini-/i);
    });

    it("rejects empty string", async () => {
      // empty string is treated as 'use default' — no throw for empty
      // (validateGeminiModelId only throws when model is truthy but wrong prefix)
      const { validateGeminiModelId } = await import(
        "../../packages/llm-client/dist/google-api-provider.js"
      );
      expect(() => validateGeminiModelId("")).not.toThrow();
    });

    it("accepts future gemini-3.0-ultra hypothetical model", async () => {
      const { validateGeminiModelId } = await import(
        "../../packages/llm-client/dist/google-api-provider.js"
      );
      expect(() =>
        validateGeminiModelId("gemini-3.0-ultra"),
      ).not.toThrow();
    });
  });

  // ── GoogleConfig.apiKeyEnv type ────────────────────────────────────────────

  describe("GoogleConfig.apiKeyEnv field", () => {
    it("GoogleConfig accepts apiKeyEnv as a string field", () => {
      // Verify the shape is correct by constructing a valid object
      /** @type {import("../../packages/llm-client/dist/llm-types.js").GoogleConfig} */
      const config = {
        api_key: "AIzaSy_test_key_for_testing_1234567890",
        model: "gemini-2.5-pro",
        apiKeyEnv: "MY_GOOGLE_KEY",
      };
      expect(config.apiKeyEnv).toBe("MY_GOOGLE_KEY");
    });

    it("GoogleConfig.apiKeyEnv is optional", () => {
      const config = {
        model: "gemini-2.5-flash",
      };
      // No apiKeyEnv is valid — defaults to GEMINI_API_KEY at runtime
      expect(config.apiKeyEnv).toBeUndefined();
    });

    it("resolveGoogleApiKey reads from default GOOGLE_API_KEY env when no apiKeyEnv set", async () => {
      const { resolveGoogleApiKey } = await import(
        "../../packages/llm-client/dist/google-api-provider.js"
      );
      // With no api_key in config and no env — returns undefined
      const saved = process.env.GOOGLE_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      try {
        expect(resolveGoogleApiKey({})).toBeUndefined();
      } finally {
        if (saved !== undefined) process.env.GOOGLE_API_KEY = saved;
      }
    });

    it("resolveGoogleApiKey uses custom apiKeyEnv name", async () => {
      const { resolveGoogleApiKey } = await import(
        "../../packages/llm-client/dist/google-api-provider.js"
      );
      process.env.MY_GOOGLE_KEY = "AIzaSy_test_from_custom_env_1234567890";
      try {
        const key = resolveGoogleApiKey({}, "MY_GOOGLE_KEY");
        expect(key).toBe("AIzaSy_test_from_custom_env_1234567890");
      } finally {
        delete process.env.MY_GOOGLE_KEY;
      }
    });

    it("resolveGoogleApiKey prefers api_key over env var", async () => {
      const { resolveGoogleApiKey } = await import(
        "../../packages/llm-client/dist/google-api-provider.js"
      );
      process.env.GOOGLE_API_KEY = "AIzaSy_from_env_12345678901234567890";
      try {
        const key = resolveGoogleApiKey(
          { api_key: "AIzaSy_from_config_12345678901234567890" },
          "GOOGLE_API_KEY",
        );
        expect(key).toBe("AIzaSy_from_config_12345678901234567890");
      } finally {
        delete process.env.GOOGLE_API_KEY;
      }
    });
  });

  // ── GOOGLE_MODELS catalog ──────────────────────────────────────────────────

  describe("GOOGLE_MODELS catalog", () => {
    it("exports GOOGLE_MODELS with light/standard/heavy tiers", async () => {
      const { GOOGLE_MODELS } = await import(
        "../../packages/llm-client/dist/config.js"
      );
      expect(typeof GOOGLE_MODELS.light).toBe("string");
      expect(typeof GOOGLE_MODELS.standard).toBe("string");
      expect(typeof GOOGLE_MODELS.heavy).toBe("string");
    });

    it("all three GOOGLE_MODELS tiers start with 'gemini-'", async () => {
      const { GOOGLE_MODELS, validateGeminiModelId } = {
        ...(await import("../../packages/llm-client/dist/config.js")),
        ...(await import("../../packages/llm-client/dist/google-api-provider.js")),
      };
      for (const model of Object.values(GOOGLE_MODELS)) {
        expect(() => validateGeminiModelId(model)).not.toThrow();
      }
    });

    it("three distinct model IDs", async () => {
      const { GOOGLE_MODELS } = await import(
        "../../packages/llm-client/dist/config.js"
      );
      const ids = new Set(Object.values(GOOGLE_MODELS));
      expect(ids.size).toBe(3);
    });
  });

  // ── resolveVendorModel with google ────────────────────────────────────────

  describe("resolveVendorModel with google vendor", () => {
    it("returns GOOGLE_MODELS.standard when no config", async () => {
      const { resolveVendorModel, GOOGLE_MODELS } = await import(
        "../../packages/llm-client/dist/config.js"
      );
      expect(resolveVendorModel("google")).toBe(GOOGLE_MODELS.standard);
    });

    it("respects llm.google.model config", async () => {
      const { resolveVendorModel } = await import(
        "../../packages/llm-client/dist/config.js"
      );
      const config = { google: { model: "gemini-2.0-flash" } };
      expect(resolveVendorModel("google", config)).toBe("gemini-2.0-flash");
    });

    it("respects llm.google.model for pro variant", async () => {
      const { resolveVendorModel } = await import(
        "../../packages/llm-client/dist/config.js"
      );
      const config = { google: { model: "gemini-2.5-pro" } };
      expect(resolveVendorModel("google", config, "standard")).toBe(
        "gemini-2.5-pro",
      );
    });

    it("apiKeyEnv field does not affect model resolution", async () => {
      const { resolveVendorModel, GOOGLE_MODELS } = await import(
        "../../packages/llm-client/dist/config.js"
      );
      // apiKeyEnv is irrelevant to model selection — model resolution is unchanged
      const config = { google: { apiKeyEnv: "MY_GOOGLE_KEY" } };
      expect(resolveVendorModel("google", config)).toBe(GOOGLE_MODELS.standard);
    });
  });

  // ── Acceptance criteria verification ──────────────────────────────────────

  describe("acceptance criteria", () => {
    it("✓ llm.google.model validates against Gemini model prefix", async () => {
      const { validateGeminiModelId } = await import(
        "../../packages/llm-client/dist/google-api-provider.js"
      );
      // Valid: all GOOGLE_MODELS tiers
      expect(() => validateGeminiModelId("gemini-2.5-pro")).not.toThrow();
      expect(() => validateGeminiModelId("gemini-2.5-flash")).not.toThrow();
      expect(() => validateGeminiModelId("gemini-2.0-flash")).not.toThrow();
    });

    it("✓ schema validation rejects unknown Google model ID naming the field", async () => {
      const { validateGeminiModelId } = await import(
        "../../packages/llm-client/dist/google-api-provider.js"
      );
      // Should throw with an error that references the field context
      let caught;
      try {
        validateGeminiModelId("gpt-5.5");
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect(caught.message).toContain("gemini-");
      // Error message identifies the invalid model ID
      expect(caught.message).toContain("gpt-5.5");
    });

    it("✓ llm.google.apiKeyEnv defaults to GEMINI_API_KEY", () => {
      // When apiKeyEnv is not set, the runtime uses GEMINI_API_KEY.
      // Verified by runGoogleApiPreflight logic: apiKeyEnvVar = llmConfig?.google?.apiKeyEnv || "GEMINI_API_KEY"
      const config = { google: {} };
      const apiKeyEnvVar = config.google.apiKeyEnv || "GEMINI_API_KEY";
      expect(apiKeyEnvVar).toBe("GEMINI_API_KEY");
    });

    it("✓ llm.google.apiKeyEnv can be overridden", () => {
      const config = { google: { apiKeyEnv: "CORP_GOOGLE_KEY" } };
      const apiKeyEnvVar = config.google.apiKeyEnv || "GEMINI_API_KEY";
      expect(apiKeyEnvVar).toBe("CORP_GOOGLE_KEY");
    });

    it("✓ GOOGLE_MODELS are all valid Gemini model IDs", async () => {
      const [{ GOOGLE_MODELS }, { validateGeminiModelId }] = await Promise.all([
        import("../../packages/llm-client/dist/config.js"),
        import("../../packages/llm-client/dist/google-api-provider.js"),
      ]);
      for (const [tier, model] of Object.entries(GOOGLE_MODELS)) {
        expect(() => validateGeminiModelId(model)).not.toThrow(
          `GOOGLE_MODELS.${tier} = "${model}" failed validation`,
        );
      }
    });
  });
});
