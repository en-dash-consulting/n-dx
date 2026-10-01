/**
 * The `/api/llm/config` route's handling of the legacy top-level `claude.*`
 * keys: read them per field beside their `llm.claude.*` twins, never write
 * them.
 *
 * Until 1.0.0 both locations are live. The read side used to hand the viewer
 * two unrelated blocks (`claude` and `legacyClaude`) and let the UI decide,
 * which meant the dashboard could show a different answer than the one the
 * next run would use. It now reports the *resolved* value plus where each
 * field came from, so "what will run" and "what is displayed" are the same
 * question.
 *
 * @see packages/web/src/server/routes-llm.ts
 * @see packages/llm-client/src/llm-config.ts — resolveClaudeConfig
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import { handleLlmRoute } from "../../../src/server/routes-llm.js";

let projectDir: string;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "ndx-llm-legacy-claude-"));
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
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(projectDir, { recursive: true, force: true });
});

async function writeConfig(config: unknown): Promise<void> {
  await writeFile(join(projectDir, ".n-dx.json"), JSON.stringify(config, null, 2), "utf-8");
}

async function readConfig(): Promise<Record<string, never>> {
  return JSON.parse(await readFile(join(projectDir, ".n-dx.json"), "utf-8"));
}

function get(): Promise<Response> {
  return fetch(`${baseUrl}/api/llm/config`);
}

function put(changes: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}/api/llm/config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ changes }),
  });
}

describe("GET /api/llm/config — legacy claude.* resolution", () => {
  it("reports a legacy-only value as the Claude model, marked as legacy", async () => {
    await writeConfig({
      claude: { model: "legacy-model", lightModel: "legacy-light" },
      llm: { vendor: "claude" },
    });

    const body = await (await get()).json() as {
      claude: { model: string | null; lightModel: string | null };
      claudeSources: Record<string, string>;
    };

    expect(body.claude.model).toBe("legacy-model");
    expect(body.claude.lightModel).toBe("legacy-light");
    expect(body.claudeSources).toEqual({ model: "legacy", lightModel: "legacy" });
  });

  it("prefers the modern key per field and marks only the field it came from", async () => {
    await writeConfig({
      claude: { model: "legacy-model", lightModel: "legacy-light" },
      llm: { vendor: "claude", claude: { model: "modern-model" } },
    });

    const body = await (await get()).json() as {
      claude: { model: string | null; lightModel: string | null };
      claudeSources: Record<string, string>;
    };

    // The half that used to break: a modern block holding only `model` shadowed
    // the whole legacy block, so `lightModel` silently reverted to the default.
    expect(body.claude.model).toBe("modern-model");
    expect(body.claude.lightModel).toBe("legacy-light");
    expect(body.claudeSources).toEqual({ model: "llm", lightModel: "legacy" });
  });

  it("reports no source for a field neither location sets", async () => {
    await writeConfig({ llm: { vendor: "claude", claude: { model: "modern-model" } } });

    const body = await (await get()).json() as {
      claude: { lightModel: string | null };
      claudeSources: Record<string, string>;
    };

    expect(body.claude.lightModel).toBeNull();
    expect(body.claudeSources).toEqual({ model: "llm" });
  });
});

describe("PUT /api/llm/config — legacy claude.* keys are read-only", () => {
  beforeEach(async () => {
    await writeConfig({ llm: { vendor: "claude" } });
  });

  for (const [legacy, replacement] of [
    ["claude.model", "llm.claude.model"],
    ["claude.lightModel", "llm.claude.lightModel"],
  ] as const) {
    it(`rejects ${legacy} with a 400 naming ${replacement}`, async () => {
      const res = await put({ [legacy]: "claude-sonnet-5" });
      expect(res.status).toBe(400);

      const body = await res.json() as { error: string };
      expect(body.error).toContain(legacy);
      expect(body.error).toContain(replacement);
    });

    it(`does not write anything when ${legacy} is refused`, async () => {
      await put({ [legacy]: "claude-sonnet-5" });
      const config = await readConfig();
      expect(config.claude).toBeUndefined();
    });
  }

  it("refuses the whole batch when a legacy key rides along with a valid one", async () => {
    // Validation runs over every change before any of them is applied, so one
    // bad key must not leave a half-applied config behind.
    const res = await put({
      "llm.claude.lightModel": "claude-haiku-4-5",
      "claude.model": "claude-sonnet-5",
    });
    expect(res.status).toBe(400);

    const config = await readConfig();
    expect((config.llm as never as Record<string, never>).claude).toBeUndefined();
  });

  it("still accepts the modern twin", async () => {
    const res = await put({ "llm.claude.model": "claude-sonnet-5" });
    expect(res.status).toBe(200);

    const config = await readConfig();
    expect((config.llm as never as Record<string, never>).claude).toEqual({ model: "claude-sonnet-5" });
  });

  it("leaves an existing legacy value in place when the modern twin is written", async () => {
    await writeConfig({ claude: { model: "legacy-model" }, llm: { vendor: "claude" } });

    const res = await put({ "llm.claude.model": "claude-sonnet-5" });
    expect(res.status).toBe(200);

    const config = await readConfig();
    expect((config.claude as never as Record<string, never>).model).toBe("legacy-model");
  });
});
