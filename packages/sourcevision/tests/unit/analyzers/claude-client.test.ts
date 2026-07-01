/**
 * Tests for the sourcevision LLM bridge (claude-client.ts).
 *
 * Verifies that model resolution delegates to the centralized
 * resolveVendorModel() from @n-dx/llm-client, so that changing the
 * configured model propagates uniformly to all sourcevision call sites.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NEWEST_MODELS, TIER_MODELS } from "@n-dx/llm-client";

// ── Mock @n-dx/llm-client so we can intercept client.complete calls ──────────

const mockComplete = vi.fn().mockResolvedValue({ text: "ok" });

vi.mock("@n-dx/llm-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@n-dx/llm-client")>();
  return {
    ...actual,
    createLLMClient: vi.fn(() => ({
      mode: "cli",
      complete: mockComplete,
    })),
  };
});

// Import the module AFTER the mock is set up so it picks up the mock factory.
import {
  callClaude,
  setLLMConfig,
  getAuthMode,
  resolveLightModel,
  DEFAULT_MODEL,
  DEFAULT_CODEX_MODEL,
} from "../../../src/analyzers/claude-client.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockComplete.mockResolvedValue({ text: "ok" });
  // Reset module state between tests; setLLMConfig clears the cached client.
  setLLMConfig({ vendor: "claude" });
});

describe("claude-client model resolution", () => {
  it("DEFAULT_MODEL derives from NEWEST_MODELS.claude — not a hard-coded string", () => {
    expect(DEFAULT_MODEL).toBe(NEWEST_MODELS.claude);
  });

  it("DEFAULT_CODEX_MODEL derives from NEWEST_MODELS.codex — not a hard-coded string", () => {
    expect(DEFAULT_CODEX_MODEL).toBe(NEWEST_MODELS.codex);
  });

  it("uses the newest Claude model when no model is configured", async () => {
    setLLMConfig({ vendor: "claude" });
    await callClaude("hello");
    expect(mockComplete).toHaveBeenCalledWith(
      expect.objectContaining({ model: NEWEST_MODELS.claude }),
    );
  });

  it("uses a configured Claude model instead of the default", async () => {
    const customModel = "claude-opus-4-20250514";
    setLLMConfig({ vendor: "claude", claude: { model: customModel } });
    await callClaude("hello");
    expect(mockComplete).toHaveBeenCalledWith(
      expect.objectContaining({ model: customModel }),
    );
  });

  it("uses the override model argument when explicitly provided", async () => {
    setLLMConfig({ vendor: "claude", claude: { model: "claude-opus-4-20250514" } });
    const explicitModel = "claude-haiku-4-20250414";
    await callClaude("hello", explicitModel);
    expect(mockComplete).toHaveBeenCalledWith(
      expect.objectContaining({ model: explicitModel }),
    );
  });

  it("uses the newest Codex model when vendor is codex with no model configured", async () => {
    setLLMConfig({ vendor: "codex" });
    await callClaude("hello");
    expect(mockComplete).toHaveBeenCalledWith(
      expect.objectContaining({ model: NEWEST_MODELS.codex }),
    );
  });

  it("uses a configured Codex model instead of the default", async () => {
    const customCodexModel = "gpt-5-codex-custom";
    setLLMConfig({ vendor: "codex", codex: { model: customCodexModel } });
    await callClaude("hello");
    expect(mockComplete).toHaveBeenCalledWith(
      expect.objectContaining({ model: customCodexModel }),
    );
  });

  it("uses the standard-tier Google model when no model is configured", async () => {
    // NEWEST_MODELS.google is the heavy tier (gemini-2.5-pro).
    // callClaude uses standard weight, so it resolves to TIER_MODELS.google.standard.
    setLLMConfig({ vendor: "google" });
    await callClaude("hello");
    expect(mockComplete).toHaveBeenCalledWith(
      expect.objectContaining({ model: TIER_MODELS.google.standard }),
    );
  });

  it("uses a configured Google model instead of the default", async () => {
    const customGoogleModel = "gemini-2.0-flash";
    setLLMConfig({ vendor: "google", google: { model: customGoogleModel } });
    await callClaude("hello");
    expect(mockComplete).toHaveBeenCalledWith(
      expect.objectContaining({ model: customGoogleModel }),
    );
  });

  it("resolveLightModel returns the Google light-tier model when vendor is google", () => {
    setLLMConfig({ vendor: "google" });
    expect(resolveLightModel()).toBe("gemini-2.0-flash");
  });

  it("getAuthMode returns api when Google API key is configured", () => {
    setLLMConfig({ vendor: "google", google: { api_key: "test-gemini-key" } });
    expect(getAuthMode()).toBe("api");
  });

  it("getAuthMode returns cli (no-key sentinel) for google without an API key", () => {
    // Clear any ambient GEMINI_API_KEY so the result reflects the (empty)
    // config rather than the developer's environment.
    vi.stubEnv("GEMINI_API_KEY", "");
    setLLMConfig({ vendor: "google" });
    expect(getAuthMode()).toBe("cli");
    vi.unstubAllEnvs();
  });
});
