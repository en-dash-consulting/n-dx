/**
 * `ndx init` moves a claudePath an older init wrote into `.hench/config.json`.
 *
 * Before the trust review gated hench's `claudePath`, discovery persisted a
 * well-known install it found outside PATH into `.hench/config.json`. There it
 * now reads as a repository-chosen binary (`vendor-cli-path`), so the user's
 * own checkout turns untrusted on upgrade. Re-running discovery moves it to
 * `.n-dx.local.json` and leaves a hand-set value alone.
 *
 * Real files under a temp project and a temp home; only the claude probe and
 * `homedir()` are stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = vi.hoisted(() => ({ home: "" }));

vi.mock("os", async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, homedir: () => state.home || original.homedir() };
});
vi.mock("../../packages/core/win-spawn.js", async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, execFileSyncCli: vi.fn() };
});

import { execFileSyncCli } from "../../packages/core/win-spawn.js";
import { discoverClaudeCli } from "../../packages/core/claude-integration.js";
import { evaluateRepoTrust } from "../../packages/llm-client/dist/public.js";

const posix = process.platform !== "win32";
let root;
let dir;
let installed;

const readJson = (p) => JSON.parse(readFileSync(p, "utf-8"));
const henchFile = () => join(dir, ".hench", "config.json");
const localFile = () => join(dir, ".n-dx.local.json");

function writeHench(config) {
  mkdirSync(join(dir, ".hench"), { recursive: true });
  writeFileSync(henchFile(), JSON.stringify(config, null, 2) + "\n");
}

/** `claude` on PATH or not; every other probe succeeds. */
function claudeOnPath(onPath) {
  execFileSyncCli.mockImplementation((binary) => {
    if (binary === "claude" && !onPath) throw new Error("not found");
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CLAUDE_CLI_PATH;
  root = mkdtempSync(join(tmpdir(), "ndx-claude-migrate-"));
  state.home = join(root, "home");
  dir = join(root, "project");
  mkdirSync(dir, { recursive: true });
  installed = join(state.home, ".claude", "local", "claude");
  mkdirSync(join(state.home, ".claude", "local"), { recursive: true });
  writeFileSync(installed, "");
});

afterEach(() => {
  state.home = "";
  rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!posix)("discoverClaudeCli — a claudePath an older init wrote into .hench/config.json", () => {
  it("moves it to .n-dx.local.json, and the checkout evaluates as baseline", () => {
    writeHench({ provider: "cli", claudePath: installed });
    expect(evaluateRepoTrust(dir).state).toBe("untrusted");
    claudeOnPath(false);

    expect(discoverClaudeCli(dir).path).toBe(installed);

    expect(readJson(localFile())).toEqual({ hench: { claudePath: installed } });
    expect(readJson(henchFile())).toEqual({ provider: "cli" });
    expect(evaluateRepoTrust(dir).state).toBe("baseline");
  });

  it("moves it when claude is now on PATH, without overriding a local claudePath", () => {
    writeHench({ claudePath: installed });
    claudeOnPath(true);

    discoverClaudeCli(dir);
    expect(readJson(localFile())).toEqual({ hench: { claudePath: installed } });
    expect(readJson(henchFile())).toEqual({});

    writeHench({ claudePath: installed });
    writeFileSync(localFile(), JSON.stringify({ hench: { claudePath: "/mine/claude" } }));
    discoverClaudeCli(dir);
    expect(readJson(localFile())).toEqual({ hench: { claudePath: "/mine/claude" } });
    expect(readJson(henchFile())).toEqual({});
  });

  it("matches an nvm install that has since been removed", () => {
    const gone = join(state.home, ".nvm", "versions", "node", "v18.0.0", "bin", "claude");
    writeHench({ claudePath: gone });
    claudeOnPath(true);

    discoverClaudeCli(dir);
    expect(readJson(localFile())).toEqual({ hench: { claudePath: gone } });
    expect(readJson(henchFile())).toEqual({});
  });

  it("leaves a hand-set claudePath that is not a discovery candidate", () => {
    writeHench({ claudePath: "/opt/tools/claude-wrapper" });
    claudeOnPath(true);

    discoverClaudeCli(dir);
    expect(readJson(henchFile())).toEqual({ claudePath: "/opt/tools/claude-wrapper" });
    expect(existsSync(localFile())).toBe(false);
  });
});
