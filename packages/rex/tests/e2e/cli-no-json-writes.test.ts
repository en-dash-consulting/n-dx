/**
 * Regression guard: PRD-mutating CLI commands must not write to prd.json.
 *
 * These tests run real rex CLI commands against a temporary directory
 * initialized with `rex init` (which produces only prd.md, never prd.json).
 * Each test asserts that after the mutation:
 *   - .rex/prd.json is NOT created when it was absent before.
 *   - .rex/prd.json is NOT modified when it pre-existed (legacy environment).
 *
 * Guards against silent re-introduction of JSON write paths in CLI commands.
 * No ndx start required — all assertions are filesystem checks only.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, access, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

const cliPath = join(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "..",
  "dist",
  "cli",
  "index.js",
);

function run(args: string[]): string {
  return execFileSync("node", [cliPath, ...args], {
    encoding: "utf-8",
    timeout: 10000,
  });
}

// ---------------------------------------------------------------------------
// Filesystem assertion helpers
// ---------------------------------------------------------------------------

async function prdJsonExists(dir: string): Promise<boolean> {
  try {
    await access(join(dir, ".rex", "prd.json"), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function prdJsonMtimeMs(dir: string): Promise<number> {
  return (await stat(join(dir, ".rex", "prd.json"))).mtimeMs;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("rex CLI mutations do not write prd.json", { timeout: 120_000 }, () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-e2e-nojson-"));
    // rex init creates prd.md; prd.json is intentionally absent.
    run(["init", tmpDir]);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ---- rex add -----------------------------------------------------------

  it("rex add does not create prd.json", async () => {
    run(["add", "epic", "--title=No-JSON Epic", tmpDir]);

    expect(await prdJsonExists(tmpDir)).toBe(false);
  });

  it("rex add does not modify a pre-existing prd.json", async () => {
    const jsonPath = join(tmpDir, ".rex", "prd.json");
    const legacyContent = '{"schema":"rex/v1","title":"Legacy","items":[]}';
    await writeFile(jsonPath, legacyContent, "utf-8");
    const mtimeBefore = await prdJsonMtimeMs(tmpDir);

    await new Promise((r) => setTimeout(r, 20));

    run(["add", "epic", "--title=Should Not Touch JSON", tmpDir]);

    expect(await prdJsonMtimeMs(tmpDir)).toBe(mtimeBefore);
  });

  // ---- rex update (title edit) -------------------------------------------

  it("rex update --title (edit) does not create prd.json", async () => {
    const out = run(["add", "epic", "--title=Edit Target", tmpDir]);
    const epicId = out.match(/ID: (.+)/)?.[1]?.trim()!;

    run(["update", epicId, "--title=Renamed Epic", tmpDir]);

    expect(await prdJsonExists(tmpDir)).toBe(false);
  });

  it("rex update --title does not modify a pre-existing prd.json", async () => {
    const out = run(["add", "epic", "--title=Pre-JSON Edit Target", tmpDir]);
    const epicId = out.match(/ID: (.+)/)?.[1]?.trim()!;

    const jsonPath = join(tmpDir, ".rex", "prd.json");
    const legacyContent = '{"schema":"rex/v1","title":"Legacy","items":[]}';
    await writeFile(jsonPath, legacyContent, "utf-8");
    const mtimeBefore = await prdJsonMtimeMs(tmpDir);

    await new Promise((r) => setTimeout(r, 20));

    run(["update", epicId, "--title=Should Not Touch JSON Either", tmpDir]);

    expect(await prdJsonMtimeMs(tmpDir)).toBe(mtimeBefore);
  });

  // ---- rex prune ---------------------------------------------------------

  it("rex prune does not create prd.json", async () => {
    const out = run(["add", "epic", "--title=Prune Target", tmpDir]);
    const epicId = out.match(/ID: (.+)/)?.[1]?.trim()!;
    run(["update", epicId, "--status=in_progress", "--force", tmpDir]);
    run(["update", epicId, "--status=completed", "--force", tmpDir]);

    run(["prune", "--yes", "--no-consolidate", tmpDir]);

    expect(await prdJsonExists(tmpDir)).toBe(false);
  });

  it("rex prune does not modify a pre-existing prd.json", async () => {
    const out = run(["add", "epic", "--title=Prune Pre-JSON Target", tmpDir]);
    const epicId = out.match(/ID: (.+)/)?.[1]?.trim()!;
    run(["update", epicId, "--status=in_progress", "--force", tmpDir]);
    run(["update", epicId, "--status=completed", "--force", tmpDir]);

    const jsonPath = join(tmpDir, ".rex", "prd.json");
    const legacyContent = '{"schema":"rex/v1","title":"Legacy","items":[]}';
    await writeFile(jsonPath, legacyContent, "utf-8");
    const mtimeBefore = await prdJsonMtimeMs(tmpDir);

    await new Promise((r) => setTimeout(r, 20));

    run(["prune", "--yes", "--no-consolidate", tmpDir]);

    expect(await prdJsonMtimeMs(tmpDir)).toBe(mtimeBefore);
  });
});
