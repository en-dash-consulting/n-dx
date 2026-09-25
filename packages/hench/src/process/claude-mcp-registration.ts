/**
 * Claude local-scope MCP registrations that pin another worktree.
 *
 * `claude mcp add --scope local` — the pre-0.7 `ndx init` path — records an
 * MCP server in `~/.claude.json` under `projects.<absolute dir>.mcpServers`,
 * with the project directory baked into the server's argv absolutely. Claude
 * Code applies a repository's entry to sessions started in that repository's
 * *other* linked worktrees, so a run in a worktree can be handed a rex server
 * writing to a different checkout entirely.
 *
 * A Claude run now overrides that with its own `--mcp-config` (see
 * {@link ../process/agent-mcp-config.ts}). This module covers what that cannot:
 * Codex runs, whose adapter has no equivalent flag, and the operator's own
 * interactive sessions, which are outside any run.
 *
 * Read-only and best-effort throughout. A registration that cannot be read is
 * reported as "none found" rather than failing a run — the detector exists to
 * add a warning, and must never be the reason a run does not start.
 *
 * @module hench/process/claude-mcp-registration
 */

import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { listWorktrees } from "./exec.js";

/** MCP servers `ndx init` registers, and therefore the only ones worth reporting. */
const NDX_SERVER_NAMES = new Set(["rex", "sourcevision"]);

/** One local-scope entry whose project directory is not the run's. */
export interface ShadowingRegistration {
  /** Server name as registered — `rex` or `sourcevision`. */
  readonly server: string;
  /** The `~/.claude.json` project key the entry lives under. */
  readonly projectKey: string;
  /** The absolute directory the entry's argv pins the server to. */
  readonly pinnedDir: string;
}

/** Seams for the filesystem and git reads, injected so tests stay hermetic. */
export interface RegistrationProbe {
  /** Absolute path of Claude Code's global config file. */
  configPath(): string;
  /** Every checkout of the repository containing `cwd`, including `cwd` itself. */
  siblingCheckouts(cwd: string): Promise<string[]>;
}

/**
 * `CLAUDE_CONFIG_DIR` wins over the home directory, matching Claude Code and
 * `packages/core/claude-integration.js`.
 */
function defaultConfigPath(): string {
  return join(process.env["CLAUDE_CONFIG_DIR"] || homedir(), ".claude.json");
}

/**
 * Every working tree of the repository containing `cwd`.
 *
 * One `git worktree list` rather than a probe per config key: a real
 * `~/.claude.json` holds an entry per project the operator has opened, and only
 * the handful that are checkouts of *this* repository can shadow this run.
 *
 * @returns The checkouts, or an empty array outside a git repository.
 */
async function defaultSiblingCheckouts(cwd: string): Promise<string[]> {
  try {
    return (await listWorktrees(cwd)).map((w) => w.path);
  } catch {
    // Not a repository, git missing, or a timeout. The detector degrades to
    // checking the project directory's own key, which is still the common case.
    return [];
  }
}

export const DEFAULT_REGISTRATION_PROBE: RegistrationProbe = {
  configPath: defaultConfigPath,
  siblingCheckouts: defaultSiblingCheckouts,
};

/** `realpath` if the path exists, a normalized absolute path if it does not. */
function canonical(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

/**
 * Find local-scope registrations that would point this run's MCP servers at a
 * different checkout.
 *
 * Only entries under a project key that is `projectDir` itself or another
 * working tree of the same repository are considered — those are the keys
 * Claude Code can apply to a session started here. An entry for an unrelated
 * project on the same machine is not this run's problem and is not reported.
 *
 * @param projectDir Directory the run will execute in.
 * @returns Shadowing entries, empty when there are none or nothing is readable.
 */
export async function findShadowingRegistrations(
  projectDir: string,
  probe: RegistrationProbe = DEFAULT_REGISTRATION_PROBE,
): Promise<ShadowingRegistration[]> {
  let config: unknown;
  try {
    config = JSON.parse(readFileSync(probe.configPath(), "utf-8"));
  } catch {
    // No config, unreadable, or corrupt — nothing to warn about.
    return [];
  }

  const projects = (config as { projects?: Record<string, unknown> } | null)?.projects;
  if (!projects || typeof projects !== "object") return [];

  const target = canonical(projectDir);
  const candidateKeys = new Set(
    [projectDir, ...(await probe.siblingCheckouts(projectDir))].map(canonical),
  );

  const found: ShadowingRegistration[] = [];
  for (const [projectKey, project] of Object.entries(projects)) {
    if (!candidateKeys.has(canonical(projectKey))) continue;

    const servers = (project as { mcpServers?: Record<string, unknown> } | null)?.mcpServers;
    if (!servers || typeof servers !== "object") continue;

    for (const [server, entry] of Object.entries(servers)) {
      if (!NDX_SERVER_NAMES.has(server)) continue;

      const args = (entry as { args?: unknown } | null)?.args;
      if (!Array.isArray(args) || args.length === 0) continue;

      const last = args[args.length - 1];
      // The project directory is the trailing argument of `… mcp <dir>`. A
      // relative one (the tracked `.mcp.json` shape) re-resolves against the
      // session's cwd and is correct here by construction.
      if (typeof last !== "string" || !isAbsolute(last)) continue;

      const pinnedDir = canonical(last);
      if (pinnedDir === target) continue;

      found.push({ server, projectKey, pinnedDir });
    }
  }
  return found;
}

/**
 * Render the warning shown when a run cannot override a shadowing entry.
 *
 * @returns The lines to print, or an empty array when there is nothing to say.
 */
export function formatShadowingWarning(
  projectDir: string,
  registrations: readonly ShadowingRegistration[],
): string[] {
  if (registrations.length === 0) return [];

  const names = [...new Set(registrations.map((r) => r.server))];
  const pinned = [...new Set(registrations.map((r) => r.pinnedDir))];

  return [
    `⚠ A local-scope Claude MCP registration pins ${names.join(" and ")} to ` +
      `${pinned.join(", ")}, not ${resolve(projectDir)}.`,
    "  PRD writes made through MCP in this session may land in that checkout, " +
      "on whatever branch it has out.",
    `  Remove it with: ${names.map((n) => `claude mcp remove --scope local ${n}`).join(" && ")}`,
    "  The tracked .mcp.json resolves the project per worktree and needs no registration.",
  ];
}
