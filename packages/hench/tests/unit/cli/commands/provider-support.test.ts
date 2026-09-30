/**
 * `VENDOR_PROVIDERS` / `isProviderSupported` are the source of truth `cmdRun`
 * consults before spawning a vendor CLI or calling its API directly, and the
 * table `tests/integration/cross-package-contracts.test.js` pins the
 * dashboard's separately maintained literal against.
 */

import { describe, it, expect } from "vitest";
import { LLM_VENDOR } from "@n-dx/llm-client";
import { VENDOR_PROVIDERS, isProviderSupported } from "../../../../src/cli/commands/provider-support.js";

describe("VENDOR_PROVIDERS", () => {
  it("claude accepts cli or api", () => {
    expect(VENDOR_PROVIDERS[LLM_VENDOR.CLAUDE]).toEqual(["cli", "api"]);
  });

  it("codex accepts cli only — hench has no API loop for it", () => {
    expect(VENDOR_PROVIDERS[LLM_VENDOR.CODEX]).toEqual(["cli"]);
  });

  it("google accepts api only — no CLI binary exists", () => {
    expect(VENDOR_PROVIDERS[LLM_VENDOR.GOOGLE]).toEqual(["api"]);
  });

  it("local accepts api only — no CLI binary exists", () => {
    expect(VENDOR_PROVIDERS[LLM_VENDOR.LOCAL]).toEqual(["api"]);
  });

  it("covers every declared vendor", () => {
    expect(Object.keys(VENDOR_PROVIDERS).sort()).toEqual(
      [LLM_VENDOR.CLAUDE, LLM_VENDOR.CODEX, LLM_VENDOR.GOOGLE, LLM_VENDOR.LOCAL].sort(),
    );
  });
});

describe("isProviderSupported", () => {
  it("matches VENDOR_PROVIDERS for every vendor/provider pair", () => {
    for (const vendor of Object.keys(VENDOR_PROVIDERS) as (keyof typeof VENDOR_PROVIDERS)[]) {
      for (const provider of ["cli", "api"] as const) {
        expect(isProviderSupported(vendor, provider)).toBe(
          VENDOR_PROVIDERS[vendor].includes(provider),
        );
      }
    }
  });
});
