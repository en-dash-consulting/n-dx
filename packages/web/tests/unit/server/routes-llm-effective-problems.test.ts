/**
 * `effectiveProblems` on `GET /api/llm/config` — the reasons `ndx work` would
 * refuse the resolved `effective` block. The viewer renders these verbatim and
 * runs no check of its own, so the cases live here.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import { handleLlmRoute } from "../../../src/server/routes-llm.js";

let projectDir: string;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "ndx-llm-problems-"));
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

async function configure(ndx: unknown, hench?: unknown): Promise<void> {
  await writeFile(join(projectDir, ".n-dx.json"), JSON.stringify(ndx), "utf-8");
  if (hench) {
    await mkdir(join(projectDir, ".hench"), { recursive: true });
    await writeFile(join(projectDir, ".hench", "config.json"), JSON.stringify(hench), "utf-8");
  }
}

async function problems(): Promise<Array<{ field: string; message: string }>> {
  const res = await fetch(`${baseUrl}/api/llm/config`);
  expect(res.status).toBe(200);
  return (await res.json()).effectiveProblems;
}

describe("GET /api/llm/config — effectiveProblems", () => {
  it("is empty for a runnable config", async () => {
    await configure({ llm: { vendor: "claude" } });
    expect(await problems()).toEqual([]);
  });

  it("is empty for a project with no config at all", async () => {
    expect(await problems()).toEqual([]);
  });

  it("flags codex with provider api", async () => {
    await configure({ llm: { vendor: "codex" } }, { provider: "api" });
    const found = await problems();
    expect(found.map((p) => p.field)).toEqual(["provider"]);
    expect(found[0].message).toContain('"codex"');
  });

  it("flags codex with a claude-* model", async () => {
    await configure({ llm: { vendor: "codex", codex: { model: "claude-sonnet-4-6" } } });
    const found = await problems();
    expect(found.map((p) => p.field)).toEqual(["model"]);
    expect(found[0].message).toContain("claude-sonnet-4-6");
  });

  it("reports provider and model together", async () => {
    await configure(
      { llm: { vendor: "codex", codex: { model: "claude-sonnet-4-6" } } },
      { provider: "api" },
    );
    expect((await problems()).map((p) => p.field)).toEqual(["provider", "model"]);
  });

  it("does not check the model for the local vendor", async () => {
    await configure({ llm: { vendor: "local", local: { model: "qwen2.5-coder-7b" } } });
    expect(await problems()).toEqual([]);
  });
});
