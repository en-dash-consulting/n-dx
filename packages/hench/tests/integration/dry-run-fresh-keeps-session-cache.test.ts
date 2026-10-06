/**
 * `hench run --dry-run --fresh` — the Prepare task modal's brief preview with
 * Session: Fresh ticked. A dry run writes nothing, so the cached orientation
 * session must survive; a real run with --fresh still discards it.
 *
 * @see packages/hench/src/cli/commands/run.ts — cmdRun's --fresh step
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cmdRun } from "../../src/cli/commands/run.js";
import { readSessionCache, writeSessionCache } from "../../src/agent/lifecycle/session-cache.js";
import { resolveStore } from "../../src/prd/rex-gateway.js";
import { cleanupProjectDir, commitGitFixtureBaseline, setupProjectDir } from "../helpers/index.js";

const DOC = {
  schema: "rex/v1",
  title: "Preview",
  items: [
    {
      id: "epic-1",
      title: "Preview Epic",
      level: "epic" as const,
      status: "pending" as const,
      children: [{ id: "t-1", title: "A task", level: "task" as const, status: "pending" as const }],
    },
  ],
};

const CACHED = { parentId: "sess-1", svFingerprint: "fp", vendor: "claude", model: "m" };

let projectDir: string;
let henchDir: string;
let out: string[];

beforeEach(async () => {
  let rexDir: string;
  ({ projectDir, henchDir, rexDir } = await setupProjectDir("hench-dry-fresh-"));
  await (await resolveStore(rexDir)).saveDocument(DOC as never);
  await writeFile(
    join(projectDir, ".n-dx.json"),
    JSON.stringify({ llm: { vendor: "claude", claude: { cli_path: process.execPath } } }),
    "utf-8",
  );
  commitGitFixtureBaseline(projectDir);
  await writeSessionCache(henchDir, CACHED);
  out = [];
  vi.spyOn(console, "log").mockImplementation((...a) => {
    out.push(a.map(String).join(" ").replace(/\u001b\[[0-9;]*m/g, ""));
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupProjectDir(projectDir);
});

describe("--fresh and the session cache", () => {
  it("a dry run leaves the cache intact and says it would discard it", async () => {
    await cmdRun(projectDir, { task: "t-1", "dry-run": "true", fresh: "true", auto: "true" });

    expect(await readSessionCache(henchDir)).toMatchObject(CACHED);
    expect(out.join("\n")).toMatch(/Would discard the cached orientation session/);
  });

  it("a real run clears the cache before any task runs", async () => {
    // A task the run refuses: the clear happens first, then selection throws,
    // so no agent is started.
    await cmdRun(projectDir, { task: "nope", fresh: "true", auto: "true" }).catch(() => {});

    expect(await readSessionCache(henchDir)).toBeUndefined();
  });
});
