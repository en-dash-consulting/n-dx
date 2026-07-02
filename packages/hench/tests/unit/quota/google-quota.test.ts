/**
 * Unit tests for the Google quota adapter.
 *
 * Google AI Studio does not expose a public quota API, so `fetchGoogleQuota`
 * always returns `{ ok: false, reason: "unavailable" }`. These tests verify
 * the adapter contract and the way `checkQuotaRemaining` integrates it.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchGoogleQuota } from "../../../src/quota/google-quota.js";

// ── fetchGoogleQuota ──────────────────────────────────────────────────────────

describe("fetchGoogleQuota", () => {
  it("always returns ok:false with reason unavailable", () => {
    const result = fetchGoogleQuota({ model: "gemini-2.5-flash" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unavailable");
    }
  });

  it("returns unavailable for any model string", () => {
    expect(fetchGoogleQuota({ model: "gemini-2.0-flash" }).ok).toBe(false);
    expect(fetchGoogleQuota({ model: "gemini-2.5-pro" }).ok).toBe(false);
    expect(fetchGoogleQuota({ model: "" }).ok).toBe(false);
  });
});

// ── checkQuotaRemaining Google branch ─────────────────────────────────────────

// Mock the config loaders so no real disk reads occur.
vi.mock("../../../src/prd/llm-gateway.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/prd/llm-gateway.js")>();
  return {
    ...actual,
    loadLLMConfig: vi.fn().mockResolvedValue({ vendor: "google" }),
    resolveVendorModel: vi.fn().mockImplementation(
      (vendor: string) => (vendor === "google" ? "gemini-2.5-flash" : `${vendor}-model`),
    ),
  };
});

vi.mock("../../../src/store/project-config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/store/project-config.js")>();
  return {
    ...actual,
    resolveLLMVendor: vi.fn().mockReturnValue("google"),
  };
});

// Prevent the claude quota from adding to results (no budget configured).
vi.mock("../../../src/quota/claude-quota.js", () => ({
  fetchClaudeQuota: vi.fn().mockReturnValue({ ok: false, reason: "no_budget" }),
}));

describe("checkQuotaRemaining — Google vendor", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("includes a google quota entry with unavailable=true when vendor is google", async () => {
    const { checkQuotaRemaining } = await import("../../../src/quota/index.js");
    const results = await checkQuotaRemaining();

    const googleEntry = results.find((r) => r.vendor === "google");
    expect(googleEntry).toBeDefined();
    expect(googleEntry?.unavailable).toBe(true);
    expect(googleEntry?.model).toBe("gemini-2.5-flash");
  });

  it("google entry has percentRemaining=0 (sentinel for unavailable)", async () => {
    const { checkQuotaRemaining } = await import("../../../src/quota/index.js");
    const results = await checkQuotaRemaining();

    const googleEntry = results.find((r) => r.vendor === "google");
    expect(googleEntry?.percentRemaining).toBe(0);
  });
});
