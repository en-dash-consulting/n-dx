/**
 * The v1 deprecation notice through the real CLI: a PRD command on a v1 tree
 * keeps working and prints one stderr line naming `ndx migrate`, never on
 * stdout, never under `--quiet`, and never on a v2 tree.
 *
 * @see packages/rex/src/cli/legacy-layout-notice.ts
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { LEGACY_LAYOUT_NOTICE, LEGACY_NOTICE_ENV } from "../../src/cli/legacy-layout-notice.js";

const cliPath = join(fileURLToPath(import.meta.url), "..", "..", "..", "dist", "cli", "index.js");

function rex(args: string[]): { code: number | null; stdout: string; stderr: string } {
  const out = spawnSync("node", [cliPath, ...args], { encoding: "utf-8", timeout: 20_000 });
  return { code: out.status, stdout: out.stdout, stderr: out.stderr };
}

const count = (text: string): number => text.split(LEGACY_LAYOUT_NOTICE).length - 1;

describe("rex on a v1 PRD", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "rex-e2e-legacy-notice-"));
    expect(rex(["init", dir]).stderr).not.toContain(LEGACY_LAYOUT_NOTICE);
    expect(rex(["add", "epic", "--title=Billing", dir]).code).toBe(0);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("works and prints the notice once, on stderr, naming ndx migrate", () => {
    const out = rex(["status", dir]);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("Billing");
    expect(count(out.stderr)).toBe(1);
    expect(out.stdout).not.toContain(LEGACY_LAYOUT_NOTICE);
    expect(LEGACY_LAYOUT_NOTICE).toContain("ndx migrate");
  });

  it("keeps --format=json stdout parseable", () => {
    const out = rex(["status", "--format=json", dir]);
    expect(out.code).toBe(0);
    expect(() => JSON.parse(out.stdout)).not.toThrow();
    expect(count(out.stderr)).toBe(1);
  });

  it("prints nothing under --quiet", () => {
    expect(count(rex(["status", "--quiet", dir]).stderr)).toBe(0);
  });

  it(`prints nothing with ${LEGACY_NOTICE_ENV}=off`, () => {
    const out = spawnSync("node", [cliPath, "status", dir], {
      encoding: "utf-8",
      timeout: 20_000,
      env: { ...process.env, [LEGACY_NOTICE_ENV]: "off" },
    });
    expect(out.status).toBe(0);
    expect(count(out.stderr)).toBe(0);
  });

  it("finds the project when the last positional is an id, not a dir", () => {
    const id = JSON.parse(rex(["status", "--format=json", dir]).stdout).items[0].id as string;
    // From the project dir, `update <id>` has no dir positional: resolving the id as a path would find no PRD.
    const out = spawnSync("node", [cliPath, "update", id, "--priority=high"], { cwd: dir, encoding: "utf-8", timeout: 20_000 });
    expect(out.status, out.stderr).toBe(0);
    expect(count(out.stderr)).toBe(1);
  });

  it("prints nothing on a v2 tree", () => {
    mkdirSync(join(dir, ".rex", "product"));
    writeFileSync(join(dir, ".rex", "product", "index.md"), "---\ntitle: t\nschema: rex/v2\n---\n");
    expect(count(rex(["status", dir]).stderr)).toBe(0);
  });
});
