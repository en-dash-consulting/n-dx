/**
 * `ndx start` on a v2 project holding a stray `.rex/prd.json`: booting the
 * real server must not migrate it — no prd_tree/ beside product/ — and
 * /api/rex/prd must serve the v2 titles, not the stale v1 ones.
 *
 * Boots the compiled `startServer` in a child (the scoped-route-dispatch
 * pattern), because the defect lived in the startup sequence itself: a test
 * that called the migration helper directly would pass with `start.ts`
 * migrating something else.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertFreshServerBuild } from "../helpers/built-server-guard.js";
import { removeTempDir } from "../helpers/temp-dir.js";

const WEB_PKG = resolve(fileURLToPath(import.meta.url), "../../..");
const SERVER_ENTRY_URL = pathToFileURL(join(WEB_PKG, "dist/server/start.js")).href;
const FIXTURE = resolve(WEB_PKG, "../rex/tests/fixtures/v2-tree");

const CHANGE = "c0000000-0000-4000-8000-000000000001";
const STALE_TITLE = "STALE v1 title";

interface Item { title: string; children?: Item[] }
const flatten = (items: Item[]): string[] => items.flatMap((i) => [i.title, ...flatten(i.children ?? [])]);

/** Boot the server, fetch /api/rex/prd while it is up, report, exit. */
function driverScript(projectDir: string): string {
  return `
import { existsSync } from "node:fs";
import { join } from "node:path";
import { startServer } from ${JSON.stringify(SERVER_ENTRY_URL)};

const { port } = await startServer(${JSON.stringify(projectDir)}, 0, {});
const res = await fetch(\`http://127.0.0.1:\${port}/api/rex/prd\`);
const body = await res.json();
const treeExists = existsSync(join(${JSON.stringify(projectDir)}, ".rex", "prd_tree"));
console.log("NDX_RESULT=" + JSON.stringify({ status: res.status, body, treeExists }));
process.exit(0);
`;
}

describe("ndx start on a v2 project with a stray prd.json", () => {
  beforeAll(() => {
    assertFreshServerBuild();
  });

  it("creates no prd_tree/ and serves the v2 titles", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ndx-start-v2-stray-"));
    try {
      const rexDir = join(dir, ".rex");
      mkdirSync(join(dir, ".sourcevision"), { recursive: true });
      cpSync(FIXTURE, rexDir, { recursive: true });
      const v2Title = /^title: "(.+)"$/m.exec(
        readFileSync(join(rexDir, "changes", "add-apple-pay", "index.md"), "utf-8"),
      )![1];
      writeFileSync(
        join(rexDir, "prd.json"),
        JSON.stringify({
          schema: "rex/v1",
          title: "stale",
          items: [{ id: CHANGE, title: STALE_TITLE, level: "epic", status: "completed" }],
        }),
      );
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
      const result = JSON.parse(match![1]) as { status: number; body: { items: Item[] }; treeExists: boolean };

      expect(stdout).not.toMatch(/Migrated .* legacy prd\.json/);
      expect(result.treeExists).toBe(false);
      expect(existsSync(join(rexDir, "prd_tree"))).toBe(false);
      expect(existsSync(join(rexDir, "prd.json"))).toBe(true);

      expect(result.status).toBe(200);
      const titles = flatten(result.body.items);
      expect(titles).toContain(v2Title);
      expect(titles).not.toContain(STALE_TITLE);
    } finally {
      await removeTempDir(dir);
    }
  }, 90_000);
});
