/**
 * Unit tests for GET /api/llm/catalog — the per-vendor model catalog and
 * provider choices hench accepts.
 *
 * Replaces the viewer's hard-coded `MODEL_SUGGESTIONS` list
 * (`packages/web/src/viewer/views/llm-provider.ts`) as the source of truth for
 * which models to offer: cloud-vendor models come from llm-client's catalog
 * (`TIER_MODELS` / `MODEL_COSTS`), local models come from a live probe of the
 * configured local server, and provider choices come from the same table
 * hench itself consults (`packages/hench/src/cli/commands/provider-support.ts`),
 * pinned by `tests/integration/cross-package-contracts.test.js`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import { TIER_MODELS } from "@n-dx/llm-client";
import { handleLlmRoute } from "../../../src/server/routes-llm.js";

let projectDir: string;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
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
