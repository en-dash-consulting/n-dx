/**
 * The default registry's codex provider follows `llm.codex.auth`
 * (resolveVendorAuth), not "a key resolves": a stored key under `auto` or any
 * key under `cli` keeps the codex CLI, and no helper runs to decide. Every
 * value is a placeholder in a temp ndx home.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearCredentialHelperCache, setCredential, setHelperCredential } from "../../src/credential-store.js";
import { createDefaultRegistry } from "../../src/provider-registry.js";
import type { LLMConfig } from "../../src/llm-types.js";

const { execFileSyncNoShell } = vi.hoisted(() => ({ execFileSyncNoShell: vi.fn(() => "placeholder-helper-value") }));
vi.mock("../../src/exec.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/exec.js")>(), execFileSyncNoShell,
}));

const STORED = "placeholder-stored-codex-key";
const EXPORTED = "placeholder-exported-codex-key";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ndx-registry-auth-"));
  vi.stubEnv("NDX_HOME", home);
  vi.stubEnv("OPENAI_API_KEY", undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearCredentialHelperCache();
  rmSync(home, { recursive: true, force: true });
});

const codex = (config: LLMConfig) => createDefaultRegistry().create("codex", config);

describe("default registry: codex follows llm.codex.auth", () => {
  it("auth unset with a stored key: the codex CLI", () => {
    setCredential("codex", STORED, { ndxHome: home });
    expect(codex({}).info.mode).toBe("cli");
  });

  it("auth unset with a helper-backed stored key: the codex CLI, and the helper never runs", () => {
    setHelperCredential("codex", ["op", "read", "op://v/codex/key"], { ndxHome: home });
    expect(codex({}).info.mode).toBe("cli");
    expect(execFileSyncNoShell).not.toHaveBeenCalled();
  });

  it.each([
    ["an exported key", () => vi.stubEnv("OPENAI_API_KEY", EXPORTED)],
    ["a stored key", () => setCredential("codex", STORED, { ndxHome: home })],
  ])("auth cli with %s: the codex CLI, no throw", (_label, seed) => {
    seed();
    expect(codex({ codex: { auth: "cli" } }).info.mode).toBe("cli");
  });

  it("auth api with a stored key: the OpenAI API, sending that key", async () => {
    setCredential("codex", STORED, { ndxHome: home });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = codex({ codex: { auth: "api" } });
    expect(provider.info.mode).toBe("api");
    await provider.complete({ prompt: "hi", model: "gpt-5.6-terra" });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${STORED}`);
  });

  it("auth unset with an exported key: the OpenAI API, as before", () => {
    vi.stubEnv("OPENAI_API_KEY", EXPORTED);
    expect(codex({}).info.mode).toBe("api");
  });
});
