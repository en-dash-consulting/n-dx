/**
 * `vendorTiers` and `routeOverrides` of `GET /api/llm/config` — what the Tune
 * "Your tooling" tile reads beside the active vendor's `tiers` table.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import { handleLlmRoute } from "../../../src/server/routes-llm.js";

let projectDir: string;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "ndx-llm-tooling-"));
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
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(projectDir, { recursive: true, force: true });
});

async function read(config: unknown) {
  await writeFile(join(projectDir, ".n-dx.json"), JSON.stringify(config), "utf-8");
  const res = await fetch(`${baseUrl}/api/llm/config`);
  expect(res.status).toBe(200);
  return res.json();
}

describe("GET /api/llm/config — tooling summary", () => {
  it("resolves light, standard and heavy for claude, codex and local, whatever the active vendor", async () => {
    const body = await read({ llm: { vendor: "codex", claude: { model: "claude-sonnet-4-5" } } });
    for (const vendor of ["claude", "codex", "local"]) {
      expect(body.vendorTiers[vendor].map((r: { tier: string }) => r.tier)).toEqual(["light", "standard", "heavy"]);
    }
    expect(body.vendorTiers.claude.find((r: { tier: string }) => r.tier === "standard").model).toContain("claude-sonnet-4-5");
  });

  it("lists only routes that differ from the default, under the command's name", async () => {
    const body = await read({ llm: { vendor: "claude", routes: { "prd.propose": "heavy", "git.commit-message": "light" } } });
    expect(body.routeOverrides).toEqual([
      expect.objectContaining({ taskClass: "prd.propose", label: "ndx plan", tier: "heavy" }),
    ]);
  });

  it("has no overrides on a bare config", async () => {
    expect((await read({})).routeOverrides).toEqual([]);
  });
});
