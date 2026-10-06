/**
 * Unit tests for GET /api/llm/catalog — the per-vendor model catalog and
 * provider choices hench accepts.
 *
 * Replaces the viewer's hard-coded `MODEL_SUGGESTIONS` list
 * (`packages/web/src/viewer/views/robot-wrangler.ts`) as the source of truth for
 * which models to offer: cloud-vendor models come from llm-client's catalog
 * (`TIER_MODELS` / `MODEL_COSTS`), local models come from a live probe of the
 * configured local server, and provider choices come from the same table
 * hench itself consults (`packages/hench/src/cli/commands/provider-support.ts`),
 * pinned by `tests/integration/cross-package-contracts.test.js`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import { TIER_MODELS } from "@n-dx/llm-client";
import { handleLlmRoute, validateCatalogModel } from "../../../src/server/routes-llm.js";
import { CATALOG_CACHE_TTL_MS } from "../../../src/server/llm-catalog.js";

// The CLI probe spawns `<binary> --version`; stub it so no test depends on a
// CLI being installed.
const execMock = vi.hoisted(() => vi.fn());
vi.mock("@n-dx/llm-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@n-dx/llm-client")>()),
  exec: execMock,
}));

const realFetch = globalThis.fetch;
/** Stands in for the Anthropic and OpenAI APIs; every other request (the test's own servers) goes through. */
const vendorFetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

let projectDir: string;
let server: Server;
let baseUrl: string;

const MISSING_CLI = { stdout: "", stderr: "", exitCode: 1, error: new Error("ENOENT"), launched: false };

beforeEach(async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("CLAUDE_CLI_PATH", "");
  execMock.mockReset().mockResolvedValue(MISSING_CLI);
  vendorFetch.mockReset().mockRejectedValue(new Error("unexpected vendor fetch"));
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    return /^https:\/\/api\.(anthropic|openai)\.com\//.test(url) ? vendorFetch(url, init) : realFetch(input, init);
  });
  projectDir = await mkdtemp(join(tmpdir(), "ndx-llm-catalog-"));
  server = createServer((req, res) => {
    void handleLlmRoute(req, res, { projectDir } as never).then((handled) => {
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(projectDir, { recursive: true, force: true });
});

async function writeConfig(config: unknown): Promise<void> {
  await writeFile(join(projectDir, ".n-dx.json"), JSON.stringify(config, null, 2), "utf-8");
}

describe("GET /api/llm/catalog", () => {
  it("returns an entry for every vendor: claude, codex, google, local", async () => {
    const res = await fetch(`${baseUrl}/api/llm/catalog`);
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const vendor of ["claude", "codex", "google", "local"]) {
      expect(body[vendor], vendor).toBeDefined();
      expect(Array.isArray(body[vendor].models), `${vendor}.models`).toBe(true);
      expect(Array.isArray(body[vendor].providers), `${vendor}.providers`).toBe(true);
    }
  });

  it("returns exactly the provider choices hench accepts", async () => {
    const res = await fetch(`${baseUrl}/api/llm/catalog`);
    const body = await res.json();
    expect(body.claude.providers).toEqual(["cli", "api"]);
    expect(body.codex.providers).toEqual(["cli"]);
    expect(body.google.providers).toEqual(["api"]);
    expect(body.local.providers).toEqual(["api"]);
  });

  it("includes every TIER_MODELS entry for each cloud vendor", async () => {
    const res = await fetch(`${baseUrl}/api/llm/catalog`);
    const body = await res.json();

    for (const vendor of ["claude", "codex", "google"] as const) {
      for (const model of Object.values(TIER_MODELS[vendor])) {
        if (!model) continue; // local's tier entries are "" — not applicable here
        expect(body[vendor].models, `${vendor} missing tier model "${model}"`).toContain(model);
      }
    }
  });

  it("does not cross-list a vendor's models under another vendor", async () => {
    const res = await fetch(`${baseUrl}/api/llm/catalog`);
    const body = await res.json();
    expect(body.claude.models.some((m: string) => m.startsWith("gpt-"))).toBe(false);
    expect(body.codex.models.some((m: string) => m.startsWith("claude-"))).toBe(false);
    expect(body.google.models.every((m: string) => m.startsWith("gemini-"))).toBe(true);
  });

  it("returns an empty local model list with a reason when the local server is unreachable", async () => {
    // No server listening on this port — the probe fails fast.
    await writeConfig({ llm: { vendor: "local", local: { host: "127.0.0.1", port: 1 } } });
    const res = await fetch(`${baseUrl}/api/llm/catalog`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.local.models).toEqual([]);
    expect(body.local.reachable).toBe(false);
    expect(typeof body.local.reason).toBe("string");
    expect(body.local.reason.length).toBeGreaterThan(0);
  });

  it("lists the live models from a reachable local server", async () => {
    const fake = createServer((req, res) => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "local-model-a" }, { id: "local-model-b" }] }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
    const addr = fake.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    try {
      await writeConfig({ llm: { vendor: "local", local: { host: "127.0.0.1", port } } });
      const res = await fetch(`${baseUrl}/api/llm/catalog`);
      const body = await res.json();
      expect(body.local.reachable).toBe(true);
      expect(body.local.models).toEqual(["local-model-a", "local-model-b"]);
      expect(body.local.reason).toBeUndefined();
    } finally {
      await new Promise<void>((resolve) => fake.close(() => resolve()));
    }
  });
});

// ---------------------------------------------------------------------------
// Live model list, installed CLI, default model
// ---------------------------------------------------------------------------

const SECRET = "sk-test-secret-key-0123456789";

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

async function getCatalog(query = ""): Promise<Record<string, any>> {
  const res = await fetch(`${baseUrl}/api/llm/catalog${query}`);
  expect(res.status).toBe(200);
  return res.json();
}

const vendorCalls = (host: string): number =>
  vendorFetch.mock.calls.filter(([url]) => url.includes(host)).length;

describe("GET /api/llm/catalog — live model list", () => {
  it("lists claude from the Anthropic Models API when a key resolves", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", SECRET);
    vendorFetch.mockResolvedValue(
      jsonOk({ data: [{ id: "claude-live-model-9" }, { id: "claude-sonnet-4-5" }, { id: "text-embedding-3-small" }] }),
    );

    const body = await getCatalog();

    expect(body.claude.source).toBe("live");
    expect(body.claude.models).toEqual(["claude-live-model-9", "claude-sonnet-4-5"]);
    expect(Number.isNaN(Date.parse(body.claude.checkedAt))).toBe(false);
    expect(body.claude.reason).toBeUndefined();
    const [url, init] = vendorFetch.mock.calls[0];
    expect(url).toContain("api.anthropic.com");
    expect((init?.headers as Record<string, string>)["x-api-key"]).toBe(SECRET);
  });

  it("lists codex from OpenAI /v1/models and drops non-chat models", async () => {
    await writeConfig({ llm: { codex: { api_key: SECRET } } });
    vendorFetch.mockResolvedValue(
      jsonOk({ data: [{ id: "gpt-live-5" }, { id: "text-embedding-3-small" }, { id: "whisper-1" }, { id: "claude-x" }] }),
    );

    const body = await getCatalog();

    expect(body.codex.source).toBe("live");
    expect(body.codex.models).toEqual(["gpt-live-5"]);
    expect(vendorFetch.mock.calls[0][0]).toContain("api.openai.com/v1/models");
  });

  it("falls back to the built-in list with a reason when no key resolves", async () => {
    const body = await getCatalog();

    for (const vendor of ["claude", "codex"]) {
      expect(body[vendor].source, vendor).toBe("built-in");
      expect(body[vendor].checkedAt, vendor).toBeNull();
      expect(body[vendor].reason, vendor).toMatch(/API key/);
    }
    expect(body.claude.models).toEqual(expect.arrayContaining(Object.values(TIER_MODELS.claude)));
    expect(vendorFetch).not.toHaveBeenCalled();
  });

  it("falls back to the built-in list when the live call fails, without failing the route or leaking the key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", SECRET);
    vendorFetch.mockRejectedValue(new Error(`connect failed for key ${SECRET}`));

    const res = await fetch(`${baseUrl}/api/llm/catalog`);
    const text = await res.text();

    expect(res.status).toBe(200);
    const body = JSON.parse(text);
    expect(body.claude.source).toBe("built-in");
    expect(body.claude.reason).toMatch(/failed/);
    expect(text).not.toContain(SECRET);
  });

  it("keeps google on the built-in list", async () => {
    const body = await getCatalog();
    expect(body.google.source).toBe("built-in");
    expect(body.google.checkedAt).toBeNull();
    expect(body.google.reason).toEqual(expect.any(String));
  });

  it("serves a cache hit within 10 minutes, then refetches after it expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.stubEnv("ANTHROPIC_API_KEY", SECRET);
    vendorFetch.mockImplementation(async () => jsonOk({ data: [{ id: "claude-live-model-9" }] }));

    await getCatalog();
    vi.advanceTimersByTime(CATALOG_CACHE_TTL_MS - 1000);
    await getCatalog();
    expect(vendorCalls("anthropic")).toBe(1);
    expect(execMock).toHaveBeenCalledTimes(2); // one claude + one codex probe, not repeated

    vi.advanceTimersByTime(2000);
    await getCatalog();
    expect(vendorCalls("anthropic")).toBe(2);
  });

  it("?refresh=true bypasses the cache and refills it", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", SECRET);
    vendorFetch
      .mockResolvedValueOnce(jsonOk({ data: [{ id: "claude-live-model-1" }] }))
      .mockResolvedValueOnce(jsonOk({ data: [{ id: "claude-live-model-2" }] }));

    expect((await getCatalog()).claude.models).toEqual(["claude-live-model-1"]);
    expect((await getCatalog("?refresh=true")).claude.models).toEqual(["claude-live-model-2"]);
    // The refresh refilled the cache: a plain read now serves it.
    expect((await getCatalog()).claude.models).toEqual(["claude-live-model-2"]);
    expect(vendorCalls("anthropic")).toBe(2);
  });

  it("a successful PUT /api/llm/config clears the cache", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", SECRET);
    vendorFetch.mockImplementation(async () => jsonOk({ data: [{ id: "claude-live-model-9" }] }));

    await getCatalog();
    const put = await fetch(`${baseUrl}/api/llm/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes: { "llm.claude.model": "claude-live-model-9" } }),
    });
    expect(put.status).toBe(200);
    await getCatalog();

    expect(vendorCalls("anthropic")).toBe(2);
  });
});

describe("GET /api/llm/catalog — installed CLI", () => {
  it("reports the version and path of a CLI that runs", async () => {
    execMock.mockImplementation(async (cmd: string) => ({
      stdout: cmd === "claude" ? "2.1.7 (Claude Code)\n" : "codex-cli 0.46.0\n",
      stderr: "",
      exitCode: 0,
      error: null,
      launched: true,
    }));

    const body = await getCatalog();

    expect(body.claude.cli).toEqual({ found: true, version: "2.1.7", path: "claude" });
    expect(body.codex.cli).toEqual({ found: true, version: "0.46.0", path: "codex" });
    expect(execMock).toHaveBeenCalledWith("claude", ["--version"], expect.objectContaining({ timeout: 5000 }));
  });

  it("reports a missing CLI as not found", async () => {
    const body = await getCatalog();
    expect(body.claude.cli).toEqual({ found: false, version: null, path: null });
    expect(body.codex.cli).toEqual({ found: false, version: null, path: null });
  });

  it("resolves the binary the way runs do: env, then .n-dx.local.json over .n-dx.json", async () => {
    await writeConfig({ cli: { claudePath: "/shared/claude" }, llm: { codex: { cli_path: "/shared/codex" } } });
    await writeFile(
      join(projectDir, ".n-dx.local.json"),
      JSON.stringify({ llm: { codex: { cli_path: "/local/codex" } } }),
      "utf-8",
    );
    execMock.mockResolvedValue({ stdout: "1.0.0", stderr: "", exitCode: 0, error: null, launched: true });

    const body = await getCatalog();
    expect(body.claude.cli.path).toBe("/shared/claude");
    expect(body.codex.cli.path).toBe("/local/codex");

    vi.stubEnv("CLAUDE_CLI_PATH", "/env/claude");
    expect((await getCatalog("?refresh=true")).claude.cli.path).toBe("/env/claude");
  });
});

describe("GET /api/llm/catalog — defaultModel", () => {
  it("is the vendor default with nothing configured", async () => {
    const body = await getCatalog();
    expect(body.claude.defaultModel).toEqual(expect.any(String));
    expect(body.claude.defaultModel).not.toBe("");
    expect(body.codex.defaultModel).not.toBe("");
    expect(body.codex.defaultModel).not.toBe(body.claude.defaultModel);
  });

  it("follows llm.<vendor>.model, and legacy claude.model for Claude", async () => {
    await writeConfig({ llm: { codex: { model: "gpt-pinned" } }, claude: { model: "claude-legacy-pinned" } });
    const body = await getCatalog();
    expect(body.codex.defaultModel).toBe("gpt-pinned");
    expect(body.claude.defaultModel).toBe("claude-legacy-pinned");
  });
});

describe("validateCatalogModel — the execute route's per-run model check", () => {
  it("still accepts a live-only model the modal offered after the catalog cache expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.stubEnv("ANTHROPIC_API_KEY", SECRET);
    vendorFetch.mockImplementation(async () => jsonOk({ data: [{ id: "claude-live-model-9" }] }));

    // The modal read the catalog, then the operator took longer than its cache lives.
    expect((await getCatalog()).claude.models).toContain("claude-live-model-9");
    vi.advanceTimersByTime(CATALOG_CACHE_TTL_MS + 1000);

    expect(await validateCatalogModel(projectDir, "claude", "claude-live-model-9")).toBeNull();
    expect(vendorCalls("anthropic")).toBe(2);
  });

  it("never waits on the vendor API for a built-in model", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", SECRET);
    expect(await validateCatalogModel(projectDir, "claude", TIER_MODELS.claude.standard)).toBeNull();
    expect(vendorFetch).not.toHaveBeenCalled();
  });

  it("refuses a model in neither list", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", SECRET);
    vendorFetch.mockImplementation(async () => jsonOk({ data: [{ id: "claude-live-model-9" }] }));
    expect(await validateCatalogModel(projectDir, "claude", "claude-made-up-1"))
      .toBe('Model "claude-made-up-1" is not in the claude catalog.');
  });
});
