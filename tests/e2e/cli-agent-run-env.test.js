/**
 * The hench agent run that `ndx work`, `ndx self-heal` and `ndx pair-programming` spawn carries
 * NDX_AGENT_RUN=1 and NDX_LEGACY_NOTICE=off, and `ndx migrate` refuses while
 * NDX_AGENT_RUN is set. Child CLIs are replaced by a double that records the
 * environment it receives.
 *
 * @see packages/core/cli.js (AGENT_RUN_ENV, handleMigrate)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  CLI_PATH,
  createTmpDir,
  removeTmpDir,
  setupHenchDir,
  setupSourcevisionDir,
  withSandboxedClaudeConfig,
} from "./e2e-helpers.js";

const PRELOAD = pathToFileURL(join(import.meta.dirname, "../fixtures/agent-run-env/spawn-preload.mjs")).href;
const NOTICE = "Deprecated: this PRD uses the v1 layout (prd_tree/). Run 'ndx migrate'";

function ndx(args, { env: extra = {}, ...opts } = {}) {
  // The ambient shell may be inside an agent run; each test sets what it needs.
  const env = { ...process.env, NDX_PREFLIGHT_PAUSE_MS: "0" };
  delete env.NDX_LEGACY_NOTICE;
  delete env.NDX_AGENT_RUN;
  Object.assign(env, extra);
  const out = spawnSync("node", [CLI_PATH, ...args], {
    encoding: "utf-8",
    timeout: 60_000,
    windowsHide: true,
    ...withSandboxedClaudeConfig({ env, ...opts }),
  });
  return { stdout: out.stdout, stderr: out.stderr, status: out.status };
}

describe("agent run environment", () => {
  let dir;
  let log;

  /** Run ndx with every rex, hench and sourcevision child replaced by the recording double. */
  function ndxWithDoubles(args) {
    const nodeOptions = [process.env.NODE_OPTIONS, `--import=${PRELOAD}`].filter(Boolean).join(" ");
    return ndx(args, { env: { NODE_OPTIONS: nodeOptions, NDX_TEST_CHILD_ENV_LOG: log } });
  }

  const records = () =>
    readFileSync(log, "utf-8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));

  beforeEach(async () => {
    dir = await createTmpDir("ndx-agent-run-env-");
    log = join(dir, "children.jsonl");
    await setupSourcevisionDir(dir);
    await setupHenchDir(dir);
    await writeFile(join(dir, ".n-dx.json"), JSON.stringify({ llm: { vendor: "claude" } }) + "\n");
    expect(ndx(["rex", "init", dir]).status).toBe(0);
    expect(ndx(["rex", "add", "epic", "--title=Billing", dir]).status).toBe(0);
  });

  afterEach(async () => {
    await removeTmpDir(dir);
  });

  it("ndx self-heal prints the v1 notice once and silences its rex and hench children", () => {
    const out = ndxWithDoubles(["self-heal", "--auto", "--yes", dir]);
    expect(out.status, out.stderr).toBe(0);
    expect(out.stderr.split(NOTICE).length - 1).toBe(1);

    const children = records();
    expect(children.some((r) => r.tool === "rex")).toBe(true);
    for (const child of children) expect(child.NDX_LEGACY_NOTICE).toBe("off");

    const hench = children.filter((r) => r.tool === "hench");
    expect(hench).toHaveLength(1);
    expect(hench[0].NDX_AGENT_RUN).toBe("1");
    // Only the agent run is marked; self-heal's own rex steps are not.
    for (const child of children.filter((r) => r.tool !== "hench")) expect(child.NDX_AGENT_RUN).toBeNull();
  });

  it("ndx work's hench child receives NDX_LEGACY_NOTICE=off and NDX_AGENT_RUN=1", () => {
    const out = ndxWithDoubles(["work", "--auto", dir]);
    expect(out.status, out.stderr).toBe(0);
    const hench = records().filter((r) => r.tool === "hench");
    expect(hench).toHaveLength(1);
    expect(hench[0]).toMatchObject({ NDX_LEGACY_NOTICE: "off", NDX_AGENT_RUN: "1" });
  });

  /** The rex `add` child is a double and creates nothing, so seed the task pair-programming would add. */
  function seedTask(title) {
    const status = ndx(["rex", "status", "--format=json", dir]);
    const epicId = JSON.parse(status.stdout).items.find((item) => item.level === "epic").id;
    expect(ndx(["rex", "add", "task", `--title=${title}`, `--parent=${epicId}`, dir]).status).toBe(0);
  }

  /** A codex CLI that answers --version, then fails every review with one finding. */
  async function writeFailingReviewer() {
    if (process.platform === "win32") {
      const path = join(dir, "fake-codex.cmd");
      // spawnCli quotes every argument on Windows; %~1 strips those quotes.
      await writeFile(path, '@echo off\r\nif "%~1"=="--version" exit /b 0\r\necho FAIL\r\necho - bug found\r\nexit /b 1\r\n');
      return path;
    }
    const path = join(dir, "fake-codex");
    await writeFile(path, '#!/bin/sh\n[ "$1" = "--version" ] && exit 0\necho FAIL\necho "- bug found"\nexit 1\n');
    await chmod(path, 0o755);
    return path;
  }

  it("ndx pair-programming marks its remediation hench run as well as the primary one", async () => {
    seedTask("fix it");
    const reviewer = await writeFailingReviewer();
    // Primary is claude, so the reviewer is codex; one round means one remediation pass.
    await writeFile(
      join(dir, ".n-dx.json"),
      JSON.stringify({ llm: { vendor: "claude", codex: { cli_path: reviewer } } }) + "\n",
    );
    const henchConfig = join(dir, ".hench", "config.json");
    await writeFile(
      henchConfig,
      JSON.stringify({ ...JSON.parse(readFileSync(henchConfig, "utf-8")), review: { rounds: 1 } }),
    );

    const out = ndxWithDoubles(["pair-programming", "fix it", dir]);
    expect(out.stdout).toContain("Remediation Pass 1 of 1");

    const hench = records().filter((r) => r.tool === "hench");
    expect(hench).toHaveLength(2);
    for (const run of hench) expect(run).toMatchObject({ NDX_LEGACY_NOTICE: "off", NDX_AGENT_RUN: "1" });
  });

  it("ndx pair-programming prints the v1 notice once and marks its hench run", () => {
    seedTask("fix it");

    const out = ndxWithDoubles(["pair-programming", "fix it", "--skip-review", dir]);
    expect(out.status, out.stderr).toBe(0);
    expect(out.stderr.split(NOTICE).length - 1).toBe(1);

    const hench = records().filter((r) => r.tool === "hench");
    expect(hench).toHaveLength(1);
    expect(hench[0]).toMatchObject({ NDX_LEGACY_NOTICE: "off", NDX_AGENT_RUN: "1" });
  });

  it.each([
    ["--plan", ["migrate", "--plan", "."]],
    ["--apply", ["migrate", "--apply", "."]],
    ["the bare chain", ["migrate", "."]],
  ])("ndx migrate %s refuses inside an agent run and writes nothing", (_label, args) => {
    const before = readdirSync(dir, { recursive: true }).sort();
    const out = ndx(args, { cwd: dir, env: { NDX_AGENT_RUN: "1" } });
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain("refuses inside an agent run");
    expect(readdirSync(dir, { recursive: true }).sort()).toEqual(before);
    expect(existsSync(join(dir, ".rex", "prd_tree"))).toBe(true);
  });

  it.each([
    ["rex migrate-plan", ["rex", "migrate-plan", "--rules-only", "--out=plan.json", "."]],
    ["rex migrate-apply", ["rex", "migrate-apply", "--plan=plan.json", "."]],
    ["ndx migrate-layout", ["migrate-layout", "."]],
  ])("%s refuses inside an agent run and writes nothing", (_label, args) => {
    const before = readdirSync(dir, { recursive: true }).sort();
    const out = ndx(args, { cwd: dir, env: { NDX_AGENT_RUN: "1" } });
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain("refuses inside an agent run");
    expect(readdirSync(dir, { recursive: true }).sort()).toEqual(before);
    expect(existsSync(join(dir, ".rex", "prd_tree"))).toBe(true);
  });
});
