/**
 * `ndx init <dir>` must register MCP servers for `<dir>`, not for the shell's
 * current directory.
 *
 * `registerMcpServers` shells out to `claude mcp remove` / `claude mcp add`
 * without a `cwd`, so the child inherits the caller's working directory. Since
 * `claude mcp add` defaults to local scope — which is stored per-directory —
 * `cd ~/repoA && ndx init ~/repoB` stripped repoA's rex/sourcevision
 * registrations and replaced them with entries pointing at repoB. Observed in
 * the wild via the E2E suite: the developer's own repo ended up with two MCP
 * servers aimed at a deleted temp directory.
 *
 * Both halves matter and are asserted separately: the entries must land under
 * the initialised project, and their target argument must be that project.
 *
 * Runs against the real `claude` binary inside a throwaway CLAUDE_CONFIG_DIR,
 * so it exercises the actual registration path without touching the
 * developer's config. Skipped when claude is not installed.
 *
 * @see packages/core/claude-integration.js — registerMcpServers
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CLI_PATH, DEFAULT_TIMEOUT } from "./e2e-helpers.js";

/** Is the real claude CLI installed? */
function claudeAvailable() {
  return spawnSync("claude", ["--version"], { stdio: "ignore" }).status === 0;
}

const HAS_CLAUDE = claudeAvailable();

let projectDir;
let cwdDir;
let configDir;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "ndx-mcp-scope-project-"));
  cwdDir = await mkdtemp(join(tmpdir(), "ndx-mcp-scope-cwd-"));
  configDir = await mkdtemp(join(tmpdir(), "ndx-mcp-scope-config-"));
});

afterEach(async () => {
  for (const d of [projectDir, cwdDir, configDir]) {
    await rm(d, { recursive: true, force: true });
  }
});

/** Every mcpServers map in a claude config, keyed by the project it belongs to. */
async function readRegistrations() {
  const path = join(configDir, ".claude.json");
  if (!existsSync(path)) return {};
  const config = JSON.parse(await readFile(path, "utf-8"));
  const byProject = {};
  for (const [project, entry] of Object.entries(config.projects ?? {})) {
    const servers = entry?.mcpServers;
    if (servers && Object.keys(servers).length > 0) byProject[project] = servers;
  }
  if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
    byProject["<global>"] = config.mcpServers;
  }
  return byProject;
}

describe.skipIf(!HAS_CLAUDE)("ndx init MCP registration scope", () => {
  it("registers against the initialised project, not the caller's cwd", async () => {
    execFileSync("node", [CLI_PATH, "init", "--provider=claude", projectDir], {
      encoding: "utf-8",
      timeout: DEFAULT_TIMEOUT,
      stdio: "pipe",
      cwd: cwdDir,
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    });

    const byProject = await readRegistrations();
    const projects = Object.keys(byProject);

    // `claude` resolves the project key through realpath, so compare on the
    // suffix rather than the raw temp path (/var vs /private/var on macOS).
    const base = (p) => p.split("/").pop();
    expect(
      projects.map(base),
      `MCP servers were registered under ${projects.join(", ")}, ` +
        `but the project being initialised was ${projectDir}. ` +
        `registerMcpServers must pass cwd so the child claude does not use ` +
        `the caller's working directory.`,
    ).not.toContain(base(cwdDir));

    expect(projects.length, "init registered no MCP servers at all").toBeGreaterThan(0);
    expect(projects.map(base)).toContain(base(projectDir));
  });

  it("points every server at the initialised project", async () => {
    execFileSync("node", [CLI_PATH, "init", "--provider=claude", projectDir], {
      encoding: "utf-8",
      timeout: DEFAULT_TIMEOUT,
      stdio: "pipe",
      cwd: cwdDir,
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    });

    const byProject = await readRegistrations();
    const base = (p) => p.split("/").pop();
    const offenders = [];

    for (const [project, servers] of Object.entries(byProject)) {
      for (const [name, cfg] of Object.entries(servers)) {
        const target = Array.isArray(cfg?.args) ? cfg.args[cfg.args.length - 1] : undefined;
        if (!target || base(target) !== base(projectDir)) {
          offenders.push(`${project} → ${name} targets ${target ?? "(none)"}`);
        }
      }
    }

    expect(
      offenders,
      `Every registered server must target the project being initialised ` +
        `(${projectDir}). Offenders:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("leaves other projects' registrations alone", async () => {
    // The remove-then-add cycle runs across local, project and user scope. With
    // the wrong cwd it strips whatever the caller's directory had registered,
    // which is how a developer lost their working registrations to a test.
    execFileSync(
      "claude",
      ["mcp", "add", "unrelated", "--", "node", "/tmp/unrelated.js"],
      {
        stdio: "ignore",
        timeout: DEFAULT_TIMEOUT,
        cwd: cwdDir,
        env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
      },
    );

    execFileSync("node", [CLI_PATH, "init", "--provider=claude", projectDir], {
      encoding: "utf-8",
      timeout: DEFAULT_TIMEOUT,
      stdio: "pipe",
      cwd: cwdDir,
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    });

    const byProject = await readRegistrations();
    const base = (p) => p.split("/").pop();
    const callerEntry = Object.entries(byProject).find(([p]) => base(p) === base(cwdDir));

    expect(
      callerEntry?.[1] ? Object.keys(callerEntry[1]) : [],
      "init removed or replaced a registration belonging to the caller's directory",
    ).toContain("unrelated");
  });
});

describe("ndx init MCP registration scope (availability)", () => {
  it("states whether the scope check actually ran", () => {
    expect(typeof HAS_CLAUDE).toBe("boolean");
  });
});
