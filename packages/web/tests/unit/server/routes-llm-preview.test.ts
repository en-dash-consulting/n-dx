/**
 * POST /api/llm/config/preview — resolves unsaved edits in memory.
 *
 * Pins: nothing is written (both config files hashed around each request),
 * an empty edit answers exactly what GET does, refused edits come back as
 * problems rather than errors, and the request gate treats it as the mutation-
 * shaped POST it is.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, request, type Server } from "node:http";
import { handleLlmRoute } from "../../../src/server/routes-llm.js";
import { handleRequestSecurity } from "../../../src/server/request-security.js";

const RESOLUTION_KEYS = ["effective", "effectiveProblems", "tiers", "failover", "review"] as const;

let projectDir: string;
let server: Server;
let port: number;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "ndx-llm-preview-"));
  await mkdir(join(projectDir, ".hench"), { recursive: true });
  // The same order start.ts applies: the request gate, then the route.
  server = createServer((req, res) => {
    if (handleRequestSecurity(req, res)) return;
    void handleLlmRoute(req, res, { projectDir } as never).then((handled) => {
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  port = typeof addr === "object" && addr ? addr.port : 0;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(projectDir, { recursive: true, force: true });
});

async function writeConfigs(ndx: unknown, hench: unknown = { provider: "cli" }): Promise<void> {
  await writeFile(join(projectDir, ".n-dx.json"), JSON.stringify(ndx, null, 2), "utf-8");
  await writeFile(join(projectDir, ".hench", "config.json"), JSON.stringify(hench, null, 2), "utf-8");
}

async function hashConfigs(): Promise<string> {
  const hash = createHash("sha256");
  for (const file of [join(projectDir, ".n-dx.json"), join(projectDir, ".hench", "config.json")]) {
    hash.update(await readFile(file));
  }
  return hash.digest("hex");
}

function preview(body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/api/llm/config/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/llm/config/preview", () => {
  it("resolves a vendor change without touching either config file", async () => {
    await writeConfigs({ llm: { vendor: "claude" } });
    const before = await hashConfigs();

    const res = await preview({ changes: { "llm.vendor": "codex" } });
    expect(res.status).toBe(200);
    const body = await res.json() as { effective: { vendor: string; model: string }; editProblems: unknown[] };

    expect(body.effective.vendor).toBe("codex");
    expect(body.effective.model).not.toMatch(/^claude/);
    expect(body.editProblems).toEqual([]);
    expect(await hashConfigs()).toBe(before);

    // The saved config still answers for claude.
    const saved = await (await fetch(`http://127.0.0.1:${port}/api/llm/config`)).json() as { effective: { vendor: string } };
    expect(saved.effective.vendor).toBe("claude");
  });

  it("answers exactly what GET does for an empty edit", async () => {
    await writeConfigs(
      {
        llm: { vendor: "codex", tiers: { codex: { heavy: "gpt-5.5" } } },
        hench: { models: { codex: "gpt-5.5" }, review: { mode: "pair", vendor: "claude", rounds: 2 } },
      },
      { provider: "cli" },
    );
    const get = await (await fetch(`http://127.0.0.1:${port}/api/llm/config`)).json() as Record<string, unknown>;

    for (const body of [{}, { changes: {} }, ""]) {
      const res = await preview(body);
      expect(res.status).toBe(200);
      const previewed = await res.json() as Record<string, unknown>;
      for (const key of RESOLUTION_KEYS) expect(previewed[key]).toEqual(get[key]);
      expect(previewed["editProblems"]).toEqual([]);
    }
  });

  it("applies the hench provider edit in memory", async () => {
    await writeConfigs({ llm: { vendor: "claude" } }, { provider: "cli" });
    const before = await hashConfigs();

    const body = await (await preview({ provider: "api" })).json() as {
      effective: { provider: string };
      failover: { applies: boolean };
    };

    expect(body.effective.provider).toBe("api");
    expect(body.failover.applies).toBe(true);
    expect(await hashConfigs()).toBe(before);
  });

  it("reports refused edits as problems and resolves the rest", async () => {
    await writeConfigs({ llm: { vendor: "claude" } });
    const before = await hashConfigs();

    const res = await preview({
      changes: { "llm.vendor": "codex", "llm.nope": "x", "llm.codex.model": "claude-opus-4-1" },
      provider: "api",
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      effective: { vendor: string; provider: string };
      editProblems: Array<{ path: string; message: string }>;
    };

    expect(body.editProblems.map((p) => p.path).sort()).toEqual(["llm.codex.model", "llm.nope", "provider"]);
    // The accepted edit still applies; the refused ones are absent.
    expect(body.effective.vendor).toBe("codex");
    expect(body.effective.provider).toBe("cli");
    expect(await hashConfigs()).toBe(before);
  });

  it("answers 400, not 500, for a body that is not an edit", async () => {
    await writeConfigs({});
    expect((await preview("{not json")).status).toBe(400);
    expect((await preview({ changes: ["llm.vendor"] })).status).toBe(400);
    expect((await preview({ provider: 3 })).status).toBe(400);
    expect((await preview("null")).status).toBe(400);
  });

  it("is refused like any other POST when the Origin is foreign", async () => {
    await writeConfigs({ llm: { vendor: "claude" } });
    const before = await hashConfigs();

    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          path: "/api/llm/config/preview",
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify({ changes: { "llm.vendor": "codex" } }));
    });

    expect(status).toBe(403);
    expect(await hashConfigs()).toBe(before);
  });
});
