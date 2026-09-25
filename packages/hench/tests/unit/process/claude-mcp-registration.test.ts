/**
 * Unit tests for the shadowing local-scope MCP registration detector.
 *
 * @see packages/hench/src/process/claude-mcp-registration.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findShadowingRegistrations,
  formatShadowingWarning,
} from "../../../src/process/claude-mcp-registration.js";
import type { RegistrationProbe } from "../../../src/process/claude-mcp-registration.js";

let dir: string;
let configPath: string;
let mainCheckout: string;
let worktree: string;
let unrelated: string;

/** A registration whose argv pins `pinnedDir` absolutely. */
function pinned(pinnedDir: string) {
  return {
    rex: { command: "node", args: [join(pinnedDir, "packages/rex/dist/cli/index.js"), "mcp", pinnedDir] },
    sourcevision: { command: "node", args: [join(pinnedDir, "packages/sv/dist/cli/index.js"), "mcp", pinnedDir] },
  };
}

async function writeConfig(projects: Record<string, unknown>): Promise<void> {
  await writeFile(configPath, JSON.stringify({ projects }, null, 2));
}

/** Probe that sees a two-worktree repository and nothing else. */
function probe(checkouts: string[] = [mainCheckout, worktree]): RegistrationProbe {
  return {
    configPath: () => configPath,
    siblingCheckouts: async () => checkouts,
  };
}

beforeEach(async () => {
  // realpath the sandbox: the detector canonicalizes every path it compares,
  // and on macOS `os.tmpdir()` is the `/var` symlink into `/private/var`, so
  // un-resolved fixture paths would never equal what it reports.
  dir = await realpath(await mkdtemp(join(tmpdir(), "hench-mcp-registration-")));
  configPath = join(dir, ".claude.json");
  // Not path prefixes of each other — otherwise a substring bug would pass.
  mainCheckout = join(dir, "repo-main");
  worktree = join(dir, "repo-feature");
  unrelated = join(dir, "other-project");
  for (const p of [mainCheckout, worktree, unrelated]) await mkdir(p, { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("findShadowingRegistrations", () => {
  it("reports an entry pinning the main checkout when the run is in a worktree", async () => {
    // The exact shape of the reported failure: the registration lives under
    // the main checkout's key, and Claude Code applies it to this worktree.
    await writeConfig({ [mainCheckout]: { mcpServers: pinned(mainCheckout) } });

    const found = await findShadowingRegistrations(worktree, probe());

    expect(found.map((f) => f.server).sort()).toEqual(["rex", "sourcevision"]);
    expect(found.every((f) => f.pinnedDir === mainCheckout)).toBe(true);
    expect(found.every((f) => f.projectKey === mainCheckout)).toBe(true);
  });

  it("stays silent when the entry pins the directory the run executes in", async () => {
    await writeConfig({ [worktree]: { mcpServers: pinned(worktree) } });
    expect(await findShadowingRegistrations(worktree, probe())).toEqual([]);
  });

  it("ignores an unrelated project on the same machine", async () => {
    // `~/.claude.json` holds an entry per project the operator has opened.
    // Only checkouts of this repository can shadow this run.
    await writeConfig({ [unrelated]: { mcpServers: pinned(unrelated) } });
    expect(await findShadowingRegistrations(worktree, probe())).toEqual([]);
  });

  it("ignores a cwd-relative entry, which the tracked .mcp.json writes", async () => {
    await writeConfig({
      [mainCheckout]: { mcpServers: { rex: { command: "ndx", args: ["rex", "mcp", "."] } } },
    });
    expect(await findShadowingRegistrations(worktree, probe())).toEqual([]);
  });

  it("ignores servers n-dx does not register", async () => {
    await writeConfig({
      [mainCheckout]: {
        mcpServers: { playwright: { command: "node", args: ["/x/server.js", "mcp", mainCheckout] } },
      },
    });
    expect(await findShadowingRegistrations(worktree, probe())).toEqual([]);
  });

  it("reports nothing when there is no config file", async () => {
    expect(await findShadowingRegistrations(worktree, probe())).toEqual([]);
  });

  it("reports nothing rather than throwing on a corrupt config", async () => {
    await writeFile(configPath, "{ not json");
    expect(await findShadowingRegistrations(worktree, probe())).toEqual([]);
  });

  it("still checks the run's own key when the repository cannot be listed", async () => {
    // Outside a git repository, or with git unavailable, the sibling probe
    // returns nothing — an entry filed under this very directory that pins
    // somewhere else is still wrong and still reported.
    await writeConfig({ [worktree]: { mcpServers: pinned(mainCheckout) } });

    const found = await findShadowingRegistrations(worktree, probe([]));

    expect(found).toHaveLength(2);
    expect(found[0]!.pinnedDir).toBe(mainCheckout);
  });
});

describe("formatShadowingWarning", () => {
  it("names the pinned directory and the command that removes the entry", () => {
    const lines = formatShadowingWarning(worktree, [
      { server: "rex", projectKey: mainCheckout, pinnedDir: mainCheckout },
    ]);

    const text = lines.join("\n");
    expect(text).toContain(mainCheckout);
    expect(text).toContain(worktree);
    expect(text).toContain("claude mcp remove --scope local rex");
  });

  it("says nothing when nothing was found", () => {
    expect(formatShadowingWarning(worktree, [])).toEqual([]);
  });

  it("does not repeat a directory pinned by both servers", () => {
    const lines = formatShadowingWarning(worktree, [
      { server: "rex", projectKey: mainCheckout, pinnedDir: mainCheckout },
      { server: "sourcevision", projectKey: mainCheckout, pinnedDir: mainCheckout },
    ]);
    const occurrences = lines[0]!.split(mainCheckout).length - 1;
    expect(occurrences).toBe(1);
  });
});
