/**
 * The first `/api/rex/prd` read after `ndx start` answers 200 with the PRD,
 * with no `.rex/.cache/prd.json` on disk beforehand.
 *
 * A folder tree (v1 or v2) has no `prd.md` or `prd.json` for `loadPRDSync` to
 * fall back to, so a request that beat the boot cache write answered 404 "No
 * PRD data found". Boots the compiled `startServer` in a child and fetches
 * immediately, the way start-v2-stray-legacy-prd.test.ts does.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertFreshServerBuild } from "../helpers/built-server-guard.js";
import { removeTempDir } from "../helpers/temp-dir.js";

const WEB_PKG = resolve(fileURLToPath(import.meta.url), "../../..");
const SERVER_ENTRY_URL = pathToFileURL(join(WEB_PKG, "dist/server/start.js")).href;
const V2_FIXTURE = resolve(WEB_PKG, "../rex/tests/fixtures/v2-tree");

interface Item { title: string; children?: Item[] }
const flatten = (items: Item[]): string[] => items.flatMap((i) => [i.title, ...flatten(i.children ?? [])]);

/** Boot the server, fetch /api/rex/prd at once, report, exit. */
function driverScript(projectDir: string): string {
  return `
import { existsSync } from "node:fs";
import { join } from "node:path";
import { startServer } from ${JSON.stringify(SERVER_ENTRY_URL)};

const cache = join(${JSON.stringify(projectDir)}, ".rex", ".cache", "prd.json");
const cacheBefore = existsSync(cache);
const { port } = await startServer(${JSON.stringify(projectDir)}, 0, {});
const res = await fetch(\`http://127.0.0.1:\${port}/api/rex/prd\`);
const body = await res.json();
console.log("NDX_RESULT=" + JSON.stringify({ status: res.status, body, cacheBefore }));
process.exit(0);
`;
}

async function firstPrdRead(dir: string): Promise<{ status: number; body: { items?: Item[] }; cacheBefore: boolean }> {
  const scriptPath = join(dir, "driver.mjs");
  writeFileSync(scriptPath, driverScript(dir), "utf-8");
  const { stdout, exitCode } = await new Promise<{ stdout: string; exitCode: number }>((done) => {
    execFile(process.execPath, [scriptPath], { cwd: WEB_PKG, timeout: 60_000 }, (err, out) => {
      done({ stdout: out ?? "", exitCode: err && typeof err.code === "number" ? err.code : 0 });
    });
  });
  expect(exitCode, `server exited non-zero:\n${stdout}`).toBe(0);
  const match = /NDX_RESULT=(.+)/.exec(stdout);
  expect(match, stdout).not.toBeNull();
  return JSON.parse(match![1]);
}

describe("first /api/rex/prd read after start, no boot cache on disk", () => {
  beforeAll(() => {
    assertFreshServerBuild();
  });

  it("answers 200 on a v1 folder tree", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ndx-first-read-v1-"));
    try {
      mkdirSync(join(dir, ".sourcevision"), { recursive: true });
      mkdirSync(join(dir, ".rex"), { recursive: true });
      // start migrates a legacy prd.json into .rex/prd_tree/ before serving.
      writeFileSync(
        join(dir, ".rex", "prd.json"),
        JSON.stringify({
          schema: "rex/v1",
          title: "v1",
          items: [{ id: "e0000000-0000-4000-8000-000000000001", title: "First epic", level: "epic", status: "pending" }],
        }),
      );
      const result = await firstPrdRead(dir);

      expect(result.cacheBefore).toBe(false);
      expect(result.status).toBe(200);
      expect(flatten(result.body.items ?? [])).toContain("First epic");
    } finally {
      await removeTempDir(dir);
    }
  }, 90_000);

  it("answers 200 on a v2 tree", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ndx-first-read-v2-"));
    try {
      mkdirSync(join(dir, ".sourcevision"), { recursive: true });
      cpSync(V2_FIXTURE, join(dir, ".rex"), { recursive: true });
      expect(existsSync(join(dir, ".rex", ".cache"))).toBe(false);
      const result = await firstPrdRead(dir);

      expect(result.cacheBefore).toBe(false);
      expect(result.status).toBe(200);
      expect((result.body.items ?? []).length).toBeGreaterThan(0);
    } finally {
      await removeTempDir(dir);
    }
  }, 90_000);
});
