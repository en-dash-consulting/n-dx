/**
 * A `claudePath` the repository ships in `.hench/config.json` is the binary
 * `ndx work` would spawn as the Claude CLI when no `cli_path` is set. Until
 * the user trusts the repository it is never run; the user's own
 * `.n-dx.local.json` `hench.claudePath` always is (#635 follow-up).
 *
 * Drives the real `cmdRun` and the real CLI loop. Each stand-in binary only
 * records that it ran and exits non-zero, so the run fails after the spawn —
 * which is all these tests need to see.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { recordRepoTrust } from "../../src/prd/llm-gateway.js";
import { resolveStore } from "../../src/prd/rex-gateway.js";
import { cleanupProjectDir, commitGitFixtureBaseline, setupProjectDir } from "../helpers/index.js";

const { cmdRun } = await import("../../src/cli/commands/run.js");

let projectDir: string;
let bin: string;
let home: string;

/** A shell script that appends `name` to its marker file and fails. */
async function standIn(path: string, name: string): Promise<void> {
  await writeFile(path, `#!/bin/sh\necho ${name} >> "${join(bin, "ran.log")}"\nexit 1\n`);
  await chmod(path, 0o755);
}

async function ran(): Promise<string[]> {
  const log = join(bin, "ran.log");
  return existsSync(log) ? (await readFile(log, "utf-8")).trim().split("\n") : [];
}

async function writeHenchConfig(patch: Record<string, unknown>): Promise<void> {
  const path = join(projectDir, ".hench", "config.json");
  const config = JSON.parse(await readFile(path, "utf-8"));
  await writeFile(path, JSON.stringify({ ...config, provider: "cli", ...patch }), "utf-8");
}

async function runOnce(): Promise<void> {
  // The stand-ins fail every run; the outcome is not under test.
  await cmdRun(projectDir, { auto: "true" }).catch(() => undefined);
}

beforeEach(async () => {
  ({ projectDir } = await setupProjectDir("hench-claude-path-trust-"));
  bin = await mkdtemp(join(tmpdir(), "hench-claude-path-bin-"));
  home = await mkdtemp(join(tmpdir(), "hench-claude-path-home-"));
  await standIn(join(bin, "claude"), "path-claude");
  await standIn(join(projectDir, "repo-claude"), "repo-claude");
  await (await resolveStore(join(projectDir, ".rex"))).saveDocument({
    schema: "rex/v1",
    title: "Trust",
    items: [{
      id: "epic-1", title: "Epic", level: "epic", status: "pending",
      children: [{ id: "t-one", title: "Only", level: "task", status: "pending", priority: "high" }],
    }],
  } as never);
  await writeFile(join(projectDir, ".n-dx.json"), JSON.stringify({ llm: { vendor: "claude" } }), "utf-8");
  vi.stubEnv("NDX_HOME", home);
  vi.stubEnv("PATH", `${bin}${delimiter}${process.env.PATH ?? ""}`);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await cleanupProjectDir(projectDir);
  await rm(bin, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("hench claudePath and repository trust", () => {
  it("never spawns an untrusted repository's .hench/config.json claudePath", async () => {
    await writeHenchConfig({ claudePath: join(projectDir, "repo-claude") });
    commitGitFixtureBaseline(projectDir);

    await runOnce();

    expect(await ran()).not.toContain("repo-claude");
    expect(await ran()).toContain("path-claude");
  });

  it("spawns it once the repository is trusted", async () => {
    await writeHenchConfig({ claudePath: join(projectDir, "repo-claude") });
    commitGitFixtureBaseline(projectDir);
    recordRepoTrust(projectDir);

    await runOnce();

    expect(await ran()).toContain("repo-claude");
  });

  it("spawns the user's .n-dx.local.json claudePath in an untrusted repository", async () => {
    const local = join(bin, "local-claude");
    await standIn(local, "local-claude");
    await writeHenchConfig({ claudePath: join(projectDir, "repo-claude") });
    await writeFile(join(projectDir, ".n-dx.local.json"), JSON.stringify({ hench: { claudePath: local } }), "utf-8");
    commitGitFixtureBaseline(projectDir);

    await runOnce();

    expect(await ran()).toContain("local-claude");
    expect(await ran()).not.toContain("repo-claude");
  });
});
