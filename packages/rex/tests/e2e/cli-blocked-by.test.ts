/**
 * E2E: `rex add` and `rex update` accept `--blocked-by` (comma-separated or
 * repeated), keep `--blockedBy`, and `--blocked-by=` clears the list.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FIXTURE_CHANGE, FIXTURE_TASK, copyV2Fixture } from "../helpers/v2-fixture.js";
import { resolveStore } from "../../src/store/index.js";
import { findItem } from "../../src/core/tree.js";

const cliPath = join(fileURLToPath(import.meta.url), "..", "..", "..", "dist", "cli", "index.js");

function rex(args: string[], cwd: string): string {
  const proc = spawnSync("node", [cliPath, ...args], { cwd, encoding: "utf-8", timeout: 20000, stdio: ["ignore", "pipe", "pipe"] });
  const output = (proc.stdout ?? "") + (proc.stderr ?? "");
  if (proc.status !== 0) throw new Error(`rex ${args.join(" ")} exited ${proc.status}:\n${output}`);
  return output;
}

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rex-cli-blocked-by-"));
  await copyV2Fixture(join(tmp, ".rex"), "lf");
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function addTask(title: string, ...extra: string[]): string {
  return JSON.parse(rex(["add", "task", `--title=${title}`, `--parent=${FIXTURE_CHANGE}`, ...extra, "--format=json", tmp], tmp)).id;
}

async function blockedBy(id: string): Promise<string[] | undefined> {
  const store = await resolveStore(join(tmp, ".rex"));
  return findItem((await store.loadDocument()).items, id)?.item.blockedBy;
}

describe("--blocked-by", () => {
  it("rex add sets one id, a comma list, and accumulates repeated flags", async () => {
    const a = addTask("A", `--blocked-by=${FIXTURE_TASK}`);
    expect(await blockedBy(a)).toEqual([FIXTURE_TASK]);

    const b = addTask("B", `--blocked-by=${FIXTURE_TASK},${a}`);
    expect(await blockedBy(b)).toEqual([FIXTURE_TASK, a]);

    const c = addTask("C", `--blocked-by=${FIXTURE_TASK}`, "--blocked-by", a);
    expect(await blockedBy(c)).toEqual([FIXTURE_TASK, a]);
  });

  it("--blockedBy still works, and rex update --blocked-by= clears", async () => {
    const a = addTask("A", `--blockedBy=${FIXTURE_TASK}`);
    expect(await blockedBy(a)).toEqual([FIXTURE_TASK]);

    rex(["update", a, "--blocked-by=", tmp], tmp);
    expect(await blockedBy(a) ?? []).toEqual([]);

    rex(["update", a, `--blocked-by=${FIXTURE_TASK}`, tmp], tmp);
    expect(await blockedBy(a)).toEqual([FIXTURE_TASK]);
  });

  it("rex add --help and rex update --help list --blocked-by", () => {
    expect(rex(["add", "--help"], tmp)).toContain("--blocked-by");
    expect(rex(["update", "--help"], tmp)).toContain("--blocked-by");
  });
});
