/**
 * Codex quota reads its key under `llm.codex.auth`, credential store included.
 *
 * `api` sends the stored key to the billing API; `auto` and `cli` with only a
 * stored key fetch nothing and print a notice that matches what they did. No
 * quota output carries the key.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setCredential } from "@n-dx/llm-client";

vi.mock("../../../src/prd/llm-gateway.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/prd/llm-gateway.js")>();
  return { ...actual, loadLLMConfig: vi.fn() };
});

const STORED = "sk-stored-codex-quota-key";

describe("checkQuotaRemaining — codex key from the credential store", () => {
  let home: string;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "hench-codex-quota-"));
    vi.stubEnv("NDX_HOME", home);
    vi.stubEnv("OPENAI_API_KEY", "");
    setCredential("codex", STORED, { ndxHome: home });
    fetchSpy = vi.fn(async (url: string) => {
      const body = String(url).includes("subscription") ? { hard_limit_usd: 100 } : { total_usage: 2500 };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    rmSync(home, { recursive: true, force: true });
  });

  async function run(codexAuth: "api" | "auto" | "cli") {
    const { loadLLMConfig } = await import("../../../src/prd/llm-gateway.js");
    vi.mocked(loadLLMConfig).mockResolvedValue({ vendor: "codex", codex: { auth: codexAuth } });
    const { checkQuotaRemaining, formatQuotaLog } = await import("../../../src/quota/index.js");
    const results = await checkQuotaRemaining();
    return { codex: results.find((r) => r.vendor === "codex"), log: JSON.stringify(results) + formatQuotaLog(results).join("\n") };
  }

  it("auth api fetches quota with the stored key", async () => {
    const { codex, log } = await run("api");
    expect(fetchSpy).toHaveBeenCalled();
    const headers = (fetchSpy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Bearer ${STORED}`);
    expect(codex?.unavailable).toBeUndefined();
    expect(codex?.percentRemaining).toBe(75);
    expect(log).not.toContain(STORED);
  });

  it("auth auto with only a stored key fetches nothing and says the key is unused", async () => {
    const { codex, log } = await run("auto");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(codex?.unavailable).toBe(true);
    expect(codex?.notice).toMatch(/stored codex key is unused under llm\.codex\.auth auto/);
    expect(codex?.notice).toContain("ndx config llm.codex.auth api");
    expect(log).not.toContain(STORED);
  });

  it("auth cli with only a stored key fetches nothing and names the auth setting", async () => {
    const { codex, log } = await run("cli");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(codex?.unavailable).toBe(true);
    expect(codex?.notice).toMatch(/llm\.codex\.auth cli/);
    expect(codex?.notice).toContain("ndx config llm.codex.auth api");
    expect(log).not.toContain(STORED);
  });

  it("auth api with no key anywhere says no key resolves", async () => {
    rmSync(home, { recursive: true, force: true });
    home = mkdtempSync(join(tmpdir(), "hench-codex-quota-"));
    vi.stubEnv("NDX_HOME", home);
    const { codex } = await run("api");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(codex?.notice).toMatch(/no key resolves/);
    expect(codex?.notice).toContain("ndx config credentials.codex");
  });
});
