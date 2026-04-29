/**
 * Regression guard: PRD-mutating commands must not write to .rex/prd.json.
 *
 * Tests run the ndx orchestrator and rex CLI against a temporary directory
 * bootstrapped with `rex init` (prd.md only, no prd.json). After each
 * mutation the test asserts that prd.json was neither created nor modified.
 *
 * Covers: ndx add, rex update (edit), rex prune.
 * No ndx start required — assertions are pure filesystem checks.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, access, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// CLI paths
// ---------------------------------------------------------------------------

const NDX_CLI = join(import.meta.dirname, "../../packages/core/cli.js");
const REX_CLI = join(
  import.meta.dirname,
  "../../packages/rex/dist/cli/index.js",
);

function ndx(args, opts = {}) {
  return execFileSync("node", [NDX_CLI, ...args], {
    encoding: "utf-8",
    timeout: 10_000,
    stdio: "pipe",
    ...opts,
  });
}

function rex(args) {
  return execFileSync("node", [REX_CLI, ...args], {
    encoding: "utf-8",
    timeout: 10_000,
    stdio: "pipe",
  });
}

// ---------------------------------------------------------------------------
// Filesystem assertion helpers
// ---------------------------------------------------------------------------

async function prdJsonExists(dir) {
  try {
    await access(join(dir, ".rex", "prd.json"), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function prdJsonMtimeMs(dir) {
  return (await stat(join(dir, ".rex", "prd.json"))).mtimeMs;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ndx add does not write prd.json", { timeout: 60_000 }, () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ndx-add-nojson-"));
    // rex init creates prd.md; prd.json is intentionally absent.
    rex(["init", tmpDir]);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("ndx add task does not create prd.json", async () => {
    const epicOut = rex(["add", "epic", "--title=Anchor Epic", tmpDir]);
    const epicId = epicOut.match(/ID: (.+)/)?.[1]?.trim();

    ndx(["add", "task", `--title=No-JSON Task`, `--parent=${epicId}`], {
      cwd: tmpDir,
    });

    expect(await prdJsonExists(tmpDir)).toBe(false);
  });

  it("ndx add task does not modify a pre-existing prd.json", async () => {
    const epicOut = rex(["add", "epic", "--title=Anchor Epic Pre-JSON", tmpDir]);
    const epicId = epicOut.match(/ID: (.+)/)?.[1]?.trim();

    const jsonPath = join(tmpDir, ".rex", "prd.json");
    const legacyContent = '{"schema":"rex/v1","title":"Legacy","items":[]}';
    await writeFile(jsonPath, legacyContent, "utf-8");
    const mtimeBefore = await prdJsonMtimeMs(tmpDir);

    await new Promise((r) => setTimeout(r, 20));

    ndx(["add", "task", "--title=Should Not Touch JSON", `--parent=${epicId}`], {
      cwd: tmpDir,
    });

    expect(await prdJsonMtimeMs(tmpDir)).toBe(mtimeBefore);
  });
});

describe("rex update does not write prd.json", { timeout: 60_000 }, () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-update-nojson-"));
    rex(["init", tmpDir]);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("rex update --title does not create prd.json", async () => {
    const epicOut = rex(["add", "epic", "--title=Edit Target", tmpDir]);
    const epicId = epicOut.match(/ID: (.+)/)?.[1]?.trim();

    rex(["update", epicId, "--title=Renamed Title", tmpDir]);

    expect(await prdJsonExists(tmpDir)).toBe(false);
  });

  it("rex update --status does not create prd.json", async () => {
    const epicOut = rex(["add", "epic", "--title=Status Target", tmpDir]);
    const epicId = epicOut.match(/ID: (.+)/)?.[1]?.trim();

    rex(["update", epicId, "--status=in_progress", tmpDir]);

    expect(await prdJsonExists(tmpDir)).toBe(false);
  });

  it("rex update does not modify a pre-existing prd.json", async () => {
    const epicOut = rex(["add", "epic", "--title=Pre-JSON Edit Target", tmpDir]);
    const epicId = epicOut.match(/ID: (.+)/)?.[1]?.trim();

    const jsonPath = join(tmpDir, ".rex", "prd.json");
    const legacyContent = '{"schema":"rex/v1","title":"Legacy","items":[]}';
    await writeFile(jsonPath, legacyContent, "utf-8");
    const mtimeBefore = await prdJsonMtimeMs(tmpDir);

    await new Promise((r) => setTimeout(r, 20));

    rex(["update", epicId, "--title=Should Not Touch JSON", tmpDir]);

    expect(await prdJsonMtimeMs(tmpDir)).toBe(mtimeBefore);
  });
});

describe("rex prune does not write prd.json", { timeout: 60_000 }, () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-prune-nojson-"));
    rex(["init", tmpDir]);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("rex prune does not create prd.json", async () => {
    // Build a fully-completed subtree so prune has something to remove.
    const epicOut = rex(["add", "epic", "--title=Prune Target", tmpDir]);
    const epicId = epicOut.match(/ID: (.+)/)?.[1]?.trim();
    rex(["update", epicId, "--status=completed", "--force", tmpDir]);

    rex(["prune", "--yes", "--no-consolidate", tmpDir]);

    expect(await prdJsonExists(tmpDir)).toBe(false);
  });

  it("rex prune does not modify a pre-existing prd.json", async () => {
    const epicOut = rex(["add", "epic", "--title=Pre-JSON Prune", tmpDir]);
    const epicId = epicOut.match(/ID: (.+)/)?.[1]?.trim();
    rex(["update", epicId, "--status=completed", "--force", tmpDir]);

    const jsonPath = join(tmpDir, ".rex", "prd.json");
    const legacyContent = '{"schema":"rex/v1","title":"Legacy","items":[]}';
    await writeFile(jsonPath, legacyContent, "utf-8");
    const mtimeBefore = await prdJsonMtimeMs(tmpDir);

    await new Promise((r) => setTimeout(r, 20));

    rex(["prune", "--yes", "--no-consolidate", tmpDir]);

    expect(await prdJsonMtimeMs(tmpDir)).toBe(mtimeBefore);
  });
});
