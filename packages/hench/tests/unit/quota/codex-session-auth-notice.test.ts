/**
 * Unit test for the Codex session-auth quota notice.
 *
 * The primary Codex auth path is `codex login` (ChatGPT session), which never
 * sets OPENAI_API_KEY. Previously `checkQuotaRemaining` silently skipped Codex
 * quota in that case. It must instead surface a clear "unavailable" notice when
 * Codex is the active vendor and no API key is present.
 *
 * The real `checkQuotaRemaining` is exercised; only `loadLLMConfig` is mocked so
 * the active vendor and (absent) codex key are controlled deterministically.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../src/prd/llm-gateway.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/prd/llm-gateway.js")>();
  return {
    ...actual,
    loadLLMConfig: vi.fn(),
  };
});

describe("checkQuotaRemaining — Codex session auth", () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env["OPENAI_API_KEY"];
    delete process.env["OPENAI_API_KEY"];
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env["OPENAI_API_KEY"];
    else process.env["OPENAI_API_KEY"] = savedKey;
    vi.restoreAllMocks();
  });

  it("surfaces an unavailable notice when codex is active and no API key is set", async () => {
    const { loadLLMConfig } = await import("../../../src/prd/llm-gateway.js");
    vi.mocked(loadLLMConfig).mockResolvedValue({ vendor: "codex" });

    const { checkQuotaRemaining } = await import("../../../src/quota/index.js");
    const results = await checkQuotaRemaining();

    const codex = results.find((r) => r.vendor === "codex");
    expect(codex).toBeDefined();
    expect(codex?.unavailable).toBe(true);
    expect(codex?.notice).toMatch(/session auth/i);
    expect(codex?.notice).toMatch(/OPENAI_API_KEY/);
  });

  it("does NOT surface a codex notice when claude is the active vendor", async () => {
    const { loadLLMConfig } = await import("../../../src/prd/llm-gateway.js");
    vi.mocked(loadLLMConfig).mockResolvedValue({ vendor: "claude" });

    const { checkQuotaRemaining } = await import("../../../src/quota/index.js");
    const results = await checkQuotaRemaining();

    expect(results.find((r) => r.vendor === "codex")).toBeUndefined();
  });
});
