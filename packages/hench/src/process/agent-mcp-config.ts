/**
 * MCP servers for the agent session a run spawns.
 *
 * ## Why this exists
 *
 * A Claude session inherits its MCP servers from the registrations Claude Code
 * finds for the project. One of those sources — a local-scope registration
 * (`claude mcp add --scope local`, the pre-0.7 `ndx init` path) — records an
 * **absolute** project directory in `~/.claude.json`, and Claude Code applies a
 * repository's entry to sessions started in that repository's *other* linked
 * worktrees. A run executing in a worktree therefore got a rex MCP server
 * pinned to the main checkout, and the agent's `update_task_status` wrote the
 * task file there, on whatever branch that checkout happened to have out. The
 * tracked `.mcp.json` resolves `.` per worktree and is correct, but the
 * local-scope entry shadows it.
 *
 * The per-workspace PRD lock cannot help: the write never reaches the right
 * workspace to contend for its lock.
 *
 * So the run stops inheriting. It writes its own MCP config naming **absolute**
 * project directories and passes it as `--mcp-config` alongside
 * `--strict-mcp-config`, which makes the file the session's only source of MCP
 * servers.
 *
 * ## Anchoring on the core CLI
 *
 * Both servers are spawned as `<node> <core cli.js> {rex,sv} mcp <projectDir>`
 * rather than by resolving rex and sourcevision directly. That takes both from
 * the install that launched the run, whatever its layout, and it needs no
 * hench→sourcevision dependency — hench does not depend on sourcevision, and
 * adding one to reach a CLI path would cross a tier boundary for no other
 * reason. It also makes the agent's rex the same build as hench's own, which
 * the task-completion hold relies on.
 *
 * The core CLI is named by `NDX_CLI_PATH`. That variable is inherited by child
 * processes, so it may name a *different* install than the hench that is
 * running — see {@link resolveLauncherCli}, which rejects that case rather than
 * pointing the agent at a foreign build.
 *
 * @module hench/process/agent-mcp-config
 */

import { existsSync, realpathSync } from "node:fs";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Why no launcher CLI could be used, in a form the run can print.
 *
 * - `unset` — neither `NDX_CLI_PATH` nor `N_DX_CLI_PATH` is set. A direct
 *   `hench run` sets neither.
 * - `missing` — the variable names a path that is not on disk (a stale export
 *   inherited from an older invocation).
 * - `foreign-install` — the path exists but belongs to a different n-dx install
 *   than the hench executing this run.
 */
export type LauncherRejection = "unset" | "missing" | "foreign-install";

/** Human-readable explanation for each rejection, used in the console line. */
export const LAUNCHER_REJECTION_DETAIL: Record<LauncherRejection, string> = {
  unset: "no NDX_CLI_PATH in the environment",
  missing: "NDX_CLI_PATH names a path that no longer exists",
  "foreign-install": "NDX_CLI_PATH belongs to a different n-dx install",
};

/** Result of locating the core CLI that launched this run. */
export type LauncherResolution =
  | { readonly usable: true; readonly cliPath: string }
  | { readonly usable: false; readonly reason: LauncherRejection };

/** A single stdio MCP server entry, in Claude Code's `--mcp-config` shape. */
export interface AgentMcpServer {
  readonly type: "stdio";
  readonly command: string;
  readonly args: readonly string[];
}

/** The document written to `<henchDir>/runs/<runId>.mcp.json`. */
export interface AgentMcpConfigDocument {
  readonly mcpServers: Readonly<Record<string, AgentMcpServer>>;
}

/**
 * Package root of the `@n-dx/hench` build that is executing.
 *
 * This file lives at `<pkg>/src/process/` in dev and `<pkg>/dist/process/` when
 * built, so two levels up reaches the package root either way.
 *
 * @see ./toolchain-identity.ts — `resolveNdxVersion` resolves its own
 *   `package.json` the same way, for the same reason.
 */
function ownPackageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

/** `realpath` if the path exists, the input unchanged if it does not. */
function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Package root of the hench build the core CLI at `coreCliPath` would spawn.
 *
 * Deliberately mirrors `resolveSubPackageCli` in
 * `packages/core/claude-integration.js`: monorepo-relative first, then the
 * `@n-dx/hench/dist/*` subpath. Hench cannot import that function — core is the
 * orchestration tier and hench the execution tier below it, so the dependency
 * would run the wrong way — and the mirror is the only thing that answers the
 * question this module actually needs answered: *would that CLI have launched
 * me?* Comparing install directories by path shape cannot answer it, because
 * pnpm's content-addressed store puts sibling packages under different parents.
 *
 * @returns The package root, or `undefined` when the CLI resolves no hench.
 */
function henchRootReachableFrom(coreCliPath: string): string | undefined {
  const monoRoot = resolve(dirname(coreCliPath), "../..");
  const monoCli = resolve(monoRoot, "packages/hench", "dist/cli/index.js");
  if (existsSync(monoCli)) return resolve(monoCli, "../../..");
  try {
    // `./dist/*` is hench's unconditional subpath export, so CJS resolution
    // reaches it. The package's `.` export declares only `import`/`types`
    // conditions and would throw ERR_PACKAGE_PATH_NOT_EXPORTED here.
    const cli = createRequire(coreCliPath).resolve("@n-dx/hench/dist/cli/index.js");
    return resolve(cli, "../../..");
  } catch {
    return undefined;
  }
}

/**
 * Locate the core CLI that launched this run, if it is safe to use.
 *
 * `NDX_CLI_PATH` is exported by `packages/core/cli.js` and inherited by every
 * descendant process, so a nested invocation can be handed the path of an
 * install that has nothing to do with the hench executing the run. Using it
 * blind would point the agent's rex at a foreign build — a different version
 * than the one holding this run's task open. So the path is used only after
 * confirming that the install it names resolves back to *this* hench.
 *
 * A rejection is not an error: the caller falls back to inheriting the
 * session's ambient MCP registrations, which is the behaviour that predates
 * this module.
 *
 * @param env Overridable only so tests can supply a launcher path without
 *   mutating the ambient environment.
 */
export function resolveLauncherCli(env: NodeJS.ProcessEnv = process.env): LauncherResolution {
  const raw = env["NDX_CLI_PATH"] || env["N_DX_CLI_PATH"];
  if (!raw) return { usable: false, reason: "unset" };
  if (!existsSync(raw)) return { usable: false, reason: "missing" };

  const cliPath = realpathOrSelf(raw);
  const reachable = henchRootReachableFrom(cliPath);
  if (!reachable) return { usable: false, reason: "foreign-install" };

  if (realpathOrSelf(reachable) !== realpathOrSelf(ownPackageRoot())) {
    return { usable: false, reason: "foreign-install" };
  }
  return { usable: true, cliPath };
}

/**
 * Name the run's rex server is registered under, and therefore the middle
 * segment of every `mcp__<server>__<tool>` permission written against it.
 *
 * Exported so {@link AGENT_REX_MCP_TOOLS} can be derived from it rather than
 * restating the spelling: a rename that left the grants behind would deny every
 * PRD write again, silently, and only in a headless spawn.
 */
export const REX_MCP_SERVER_NAME = "rex";

/** Name the run's sourcevision server is registered under. */
export const SOURCEVISION_MCP_SERVER_NAME = "sourcevision";

/**
 * Rex tools the spawned agent session is allowed to call.
 *
 * ## Why the grant is needed at all
 *
 * Attaching the server is not permission to use it. `ndx init` auto-approves
 * only rex's *read* tools (`AUTO_APPROVED_TOOLS` in
 * `packages/core/claude-integration.js`) — deliberately, because those settings
 * also govern the operator's interactive sessions — and a `claude -p` spawn has
 * nobody to answer the prompt for the rest. So the run's own prompts directed
 * the agent at tools the run had not allowed. Two consumer-project runs show
 * both ways that ends: one agent hand-edited the task's `index.md` and committed
 * it, bypassing the completion hold; the other ended its turn asking for
 * permission, with all of its work uncommitted.
 *
 * ## Why this exact set
 *
 * Every entry has a hench prompt behind it, and nothing else is granted — the
 * session reaches the whole rex server through the config this module writes,
 * so this list is the only thing deciding what it may call:
 *
 * - `update_task_status` — base workflow step 6 (`rex/src/workflow/default.ts`).
 * - `append_log` — base workflow step 7.
 * - `add_item` — base workflow steps 3 and 9, and the `should-fix` action of the
 *   autonomous adversarial-review pass (`../agent/analysis/adversarial-review.ts`).
 *
 * A tool no prompt asks for does not belong here. Adding one is a deliberate
 * edit with a test to match, not a convenience.
 *
 * ## Why granting the write tools is safe
 *
 * The completion hold, not the allowlist, is what protects the PRD. While a run
 * holds the task's claim, rex records the agent's status request on the claim
 * (`TaskClaims.pendingCompletion`) rather than writing it, and hench applies it
 * only once the test gate has passed. Denying the tool did not add a safeguard —
 * it pushed the agent into hand-editing the task file, which has none.
 */
export const AGENT_REX_MCP_TOOLS: readonly string[] = [
  "update_task_status",
  "append_log",
  "add_item",
].map((tool) => `mcp__${REX_MCP_SERVER_NAME}__${tool}`);

/**
 * Build the MCP server document for one run.
 *
 * Both entries name `projectDir` as an absolute path, which is the whole point:
 * an absolute directory cannot be re-resolved against another worktree's cwd,
 * and it cannot be shadowed by a registration that pins one.
 *
 * The server names come from {@link REX_MCP_SERVER_NAME} and
 * {@link SOURCEVISION_MCP_SERVER_NAME}, which are also what the agent's
 * `--allowed-tools` grants are spelled from — see {@link AGENT_REX_MCP_TOOLS}.
 * Renaming a server therefore renames its grants, instead of orphaning them.
 */
export function buildAgentMcpServers(opts: {
  readonly cliPath: string;
  readonly projectDir: string;
  readonly execPath?: string;
}): AgentMcpConfigDocument {
  const node = opts.execPath ?? process.execPath;
  const projectDir = resolve(opts.projectDir);
  const server = (subcommand: string): AgentMcpServer => ({
    type: "stdio",
    command: node,
    args: [opts.cliPath, subcommand, "mcp", projectDir],
  });
  return {
    mcpServers: {
      [REX_MCP_SERVER_NAME]: server("rex"),
      [SOURCEVISION_MCP_SERVER_NAME]: server("sv"),
    },
  };
}

/**
 * Directory holding the per-run MCP configs.
 *
 * Deliberately *not* `.hench/runs/`: `listRuns` treats every `*.json` in that
 * directory as a run record and derives the run id from the filename, so a
 * `<runId>.mcp.json` alongside it would be collected as a run called
 * `<runId>.mcp`, consume a slot in the caller's `limit`, and then be dropped
 * when it failed to validate — silently shortening `hench list`, the token
 * rollups and the dashboard's run feed.
 */
export const AGENT_MCP_DIRNAME = "mcp";

/** How long a config file outlives the run that wrote it before being swept. */
const STALE_CONFIG_MS = 7 * 24 * 60 * 60 * 1000;

/** Absolute path of the MCP config file written for a run. */
export function agentMcpConfigPath(henchDir: string, runId: string): string {
  return join(henchDir, AGENT_MCP_DIRNAME, `${runId}.json`);
}

/**
 * Drop config files left by runs that finished long ago.
 *
 * One file per run would otherwise accumulate without bound. Swept on write
 * rather than at run end so no lifecycle hook can leak one, and bounded by age
 * rather than count so a sweep can never remove the file a concurrent run's
 * session is about to read.
 */
async function pruneStaleConfigs(dir: string, now: number): Promise<void> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => {
        const path = join(dir, name);
        try {
          const info = await stat(path);
          if (now - info.mtimeMs > STALE_CONFIG_MS) await rm(path, { force: true });
        } catch {
          // Raced with another run's sweep, or unreadable. Either way the file
          // is not this run's problem.
        }
      }),
  );
}

/**
 * Write the run's MCP config and return the path to pass as `--mcp-config`.
 *
 * Written as a file rather than passed as inline JSON: inline JSON would have
 * to survive cmd.exe quoting on Windows, which is the hazard the Windows branch
 * of `buildClaudeCliArgs` already exists to work around.
 *
 * `.hench/` as a whole is *not* gitignored — `.hench/config.json` is meant to be
 * committed — so the directory this writes into earns its exemption by being
 * declared in `HENCH_RUNTIME_GITIGNORE_ENTRIES` (`../store/artifacts.ts`), which
 * is both what `hench init` writes to `.gitignore` and what the pre-run, loop
 * and completion gates discount. Leaving it out of that list is what made a
 * successful run refuse its own completion in projects whose `.gitignore`
 * predated this file.
 */
export async function writeAgentMcpConfig(opts: {
  readonly henchDir: string;
  readonly runId: string;
  readonly cliPath: string;
  readonly projectDir: string;
}): Promise<string> {
  const path = agentMcpConfigPath(opts.henchDir, opts.runId);
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  await pruneStaleConfigs(dir, Date.now());

  const doc = buildAgentMcpServers({ cliPath: opts.cliPath, projectDir: opts.projectDir });
  await writeFile(path, `${JSON.stringify(doc, null, 2)}\n`, "utf-8");
  return path;
}

/** Outcome of preparing a run's MCP config. */
export type AgentMcpConfigOutcome =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: LauncherRejection };

/**
 * Prepare the MCP config for a run, or explain why the run must inherit.
 *
 * A rejected launcher is reported, not thrown: inheriting is the behaviour that
 * predates this module and the run is still valid. A *write* failure does
 * propagate — silently falling back to inheritance there would reinstate the
 * cross-worktree write this module exists to prevent, and `.hench/runs/` is
 * already being written for the run record, so a failure is not a routine
 * condition.
 */
export async function prepareAgentMcpConfig(opts: {
  readonly henchDir: string;
  readonly runId: string;
  readonly projectDir: string;
  readonly env?: NodeJS.ProcessEnv;
}): Promise<AgentMcpConfigOutcome> {
  const launcher = resolveLauncherCli(opts.env);
  if (!launcher.usable) return { ok: false, reason: launcher.reason };

  const path = await writeAgentMcpConfig({
    henchDir: opts.henchDir,
    runId: opts.runId,
    cliPath: launcher.cliPath,
    projectDir: opts.projectDir,
  });
  return { ok: true, path };
}
