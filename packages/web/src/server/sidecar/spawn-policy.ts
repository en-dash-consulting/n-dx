/**
 * How a Sidecar session's vendor CLI is spawned so that the `ndx-sidecar`
 * broker is the only way it can cause a side effect.
 *
 * **Claude.** F1 (design §11.1) found that a deny list leaves NotebookEdit and
 * non-file side-effect tools on, and that a `permissions.allow` rule in any
 * settings file lets a matching call skip every prompt. So the spawn:
 * - allows only the read-only built-ins: `--tools Read,Grep,Glob`;
 * - loads no settings file: `--setting-sources ""`, so no operator allow rule
 *   (nor hook, nor plugin) applies;
 * - gets one MCP server, the broker: `--mcp-config <file> --strict-mcp-config`;
 * - pre-approves the broker's tools: `--allowed-tools mcp__ndx-sidecar`. Each
 *   one waits on its own card, so the CLI must not ask a second time — and in
 *   `-p` mode there is nobody to ask.
 *
 * Verified on the real CLI (Claude Code 2.1.309, F1 probe p6, design §11.1):
 * the empty `--setting-sources` is accepted, the session gets only Read, Grep,
 * Glob and the broker tools whatever the settings files allow, and a broker
 * call held 65 s returns normally. Not yet verified: a card held for many
 * minutes on the Streamable HTTP transport.
 *
 * **Codex.** A read-only sandbox that never asks for approval, on every
 * turn: a fresh `codex exec` takes `--sandbox read-only`, and a resumed one
 * re-applies the same policy as `-c sandbox_mode=` / `-c approval_policy=`
 * overrides, because the thread does not keep its starting policy and
 * `exec resume` rejects `--sandbox`. Every turn, fresh and resumed, also
 * carries ({@link sidecarCodexSpawn}):
 * - `--ignore-user-config`: `$CODEX_HOME/config.toml` is skipped, so none of
 *   the user's MCP servers loads (a `-c mcp_servers…` override merges with
 *   them and never replaces them). Auth still comes from `CODEX_HOME`. On
 *   codex-cli 0.166.0 it skips the project `.codex/config.toml` too: project
 *   config loads only for a project the user config trusts.
 * - `features.apps=false` (the Apps MCP integration loads even without the
 *   user config) and `features.shell_snapshot=false` (a snapshot would write
 *   the env-backed header values under `CODEX_HOME/shell_snapshots/`).
 * - the broker as `mcp_servers.ndx-sidecar`: its url, `required`, a 30 s
 *   startup timeout, and a tool timeout of the session's idle window, since a
 *   card waits on the operator for as long as the session can be resumed.
 *   Its headers travel as `env_http_headers`, each mapped to a variable set
 *   only in the Codex child's environment and blanked in every command the
 *   agent runs, so the broker credential is in neither argv (which is
 *   logged) nor an MCP config file. With no endpoint, no broker flag.
 * - `mcp_servers.ndx-sidecar.default_tools_approval_mode="approve"`: only
 *   the broker bypasses CLI approval. Its own operator cards still decide
 *   each write; otherwise `approval_policy=never` refuses the tool before
 *   it can reach a card. Shell approval and the sandbox stay unchanged.
 * - for every server a repository's own `.codex/config.toml` declares, from
 *   the session's checkout up to the repository root, re-read for each turn
 *   ({@link sidecarCodexProjectFlags}): `-c mcp_servers.<name>.enabled=false`
 *   plus a placeholder for the transport the file gives it
 *   (`command="ndx-sidecar-disabled"` or
 *   `url="http://127.0.0.1:9/ndx-sidecar-disabled"`). 0.166.0 does not load
 *   that file under `--ignore-user-config`, and `enabled=false` alone then
 *   builds an entry with no transport, which fails config loading;
 *   0.164.0-alpha.11.1 is unverified. The placeholder entries hold either
 *   way: over a loaded file they replace one key and `enabled=false` keeps the
 *   server off; alone they are complete, disabled entries. A file that exists
 *   but cannot be read with confidence, a server name that is not a bare key,
 *   or a server with neither or both transports refuses the turn before
 *   anything is spawned.
 * - a backstop in the session registry: a turn whose events show a tool use
 *   on any MCP server but the broker is stopped
 *   ({@link strayMcpServer}).
 * - `--ignore-user-config` drops the user's `model_provider` too. The selected
 *   provider alone is carried by `codex-provider.ts`; unsupported settings or
 *   missing credentials refuse before a turn, without selecting a fallback.
 *
 * **Hub scope.** The hub session works from the hub snapshot and must not
 * read any repository, so its Claude spawn gets no built-in tool at all
 * (`--tools ""`): the broker is all it has. Codex uses the exact host-audited
 * macOS permission profile below, never the ordinary read-only sandbox.
 * Admission checks the selected executable and paths again on each turn.
 */

import { chmodSync, lstatSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { CodexProjectConfigError, codexProjectMcpDisableFlags, compileCodexPolicyFlags } from "@n-dx/llm-client";
import type { ClaudeTurnFlags, CodexTurnFlags, ExecutionPolicy, RuntimeEvent } from "@n-dx/llm-client";
import { errorMessage } from "../response-utils.js";
import { SIDECAR_BROKER_NAME } from "./broker-policy.js";
import type { SidecarScope } from "./context-refresh.js";
import { ensureSidecarDir } from "./sidecar-dir.js";
import { readSidecarCodexProvider } from "./codex-provider.js";

/** The built-in Claude tools a Sidecar session keeps: reads only. */
export const SIDECAR_READ_TOOLS = ["Read", "Grep", "Glob"] as const;

/** The built-in Claude tools a hub-scope session keeps: none. */
export const HUB_SIDECAR_TOOLS: readonly string[] = [];

/** Why a hub-scope session cannot run on `vendor`, or null when it can. */
export const CODEX_HUB_VERSION = "0.167.0-alpha.3.2";
export const CODEX_HUB_BINARY = "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex";
export const CODEX_HUB_SHA256 = "a636331ed87605efc4cf84028ac2884a75363f9d10ead63cffb57ea0016d486e";
export const CODEX_HUB_REQUIREMENT = `Codex hub sessions require macOS and codex-cli ${CODEX_HUB_VERSION}; other platforms and versions are unverified. Configure llm.codex.cli_path to the audited executable, or use Claude.`;

export function hubVendorRefusal(vendor: string, audited?: { platform: NodeJS.Platform; version: string }): string | null {
  if (vendor === "claude") return null;
  if (vendor === "codex") {
    if (audited?.platform === "darwin" && audited.version === CODEX_HUB_VERSION) return null;
    return `A hub session cannot run on Codex without verified confinement. ${CODEX_HUB_REQUIREMENT}`;
  }
  return `A hub session runs on Claude only, not "${vendor}"`;
}

/**
 * Preflight selected settings/auth, without copying integrations or running a
 * helper. The connection rechecks with its effective environment policy.
 */
export function codexUserProviderRefusal(env: NodeJS.ProcessEnv = process.env): string | null {
  try {
    readSidecarCodexProvider(env);
    return null;
  } catch (error) {
    return errorMessage(error);
  }
}

/** Codex: read-only, never asks, no network, no writable root, no command or file tool beyond reads. */
const SIDECAR_CODEX_POLICY: ExecutionPolicy = {
  sandbox: "read-only",
  approvals: "never",
  networkAccess: false,
  writableRoots: [],
  allowedCommands: [],
  allowedFileTools: [...SIDECAR_READ_TOOLS],
};

/** Where a session's vendor CLI reaches the broker. */
export interface SidecarBrokerEndpoint {
  /** The session's broker MCP endpoint (Streamable HTTP). */
  url: string;
  /** Headers every broker request carries: the session's broker credential, the workspace. Never the dashboard token. */
  headers: Record<string, string>;
}

/** The `--mcp-config` document: the broker, or no server at all when there is no endpoint. */
export function brokerMcpConfig(endpoint?: SidecarBrokerEndpoint): { mcpServers: Record<string, unknown> } {
  return {
    mcpServers: endpoint
      ? { [SIDECAR_BROKER_NAME]: { type: "http", url: endpoint.url, headers: endpoint.headers } }
      : {},
  };
}

/**
 * Write a session's MCP config to `<dir>/<id>.mcp.json` and return its path.
 * Owner-only (0600): the headers carry the session's broker credential.
 */
export function writeBrokerMcpConfig(dir: string, sessionId: string, endpoint?: SidecarBrokerEndpoint): string {
  ensureSidecarDir(dir);
  const path = join(dir, `${sessionId}.mcp.json`);
  writeFileSync(path, JSON.stringify(brokerMcpConfig(endpoint), null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
  // `mode` applies only when the file is created.
  chmodSync(path, 0o600);
  return path;
}

/** How long the broker may take to start answering a Codex session, in seconds. */
export const SIDECAR_CODEX_STARTUP_TIMEOUT_SEC = 30;

/**
 * The environment variable that carries broker header `header` to a Codex
 * session: `x-ndx-sidecar-key` → `NDX_SIDECAR_HEADER_X_NDX_SIDECAR_KEY`.
 */
export function brokerHeaderEnvName(header: string): string {
  return `NDX_SIDECAR_HEADER_${header.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

/** What a Codex Sidecar turn adds to its spawn: flags, and the variables only its child environment carries. */
export interface SidecarCodexSpawn {
  codex: CodexTurnFlags;
  /** The broker header values, by {@link brokerHeaderEnvName}; empty without an endpoint. */
  env: Record<string, string>;
}

/**
 * The flags that turn off every MCP server the project Codex config for `cwd`
 * declares, except the broker.
 *
 * @throws Error naming the file when a project config exists but cannot be
 *   read with confidence: the turn must not start.
 */
export function sidecarCodexProjectFlags(cwd: string): string[] {
  try {
    return codexProjectMcpDisableFlags(cwd, [SIDECAR_BROKER_NAME]);
  } catch (error) {
    if (!(error instanceof CodexProjectConfigError)) throw error;
    throw new Error(`A Codex Sidecar turn cannot start: it could not keep this repository's MCP servers out. ${error.message}`);
  }
}

/**
 * A Codex Sidecar turn's flags, fresh and resumed, and the broker header
 * variables its child environment carries.
 *
 * @param idleMs The session's idle window. Codex fails a tool call that
 *   outlasts `tool_timeout_sec` (60 s by default), and a broker call waits on
 *   its card until the operator decides or the turn stops, so a call may wait
 *   as long as the session can be resumed.
 * @param cwd The session's checkout, where each turn reads the project Codex
 *   config ({@link sidecarCodexProjectFlags}).
 */
export function sidecarCodexSpawn(endpoint: SidecarBrokerEndpoint | undefined, idleMs: number, cwd: string): SidecarCodexSpawn {
  const configFlags = [
    "--ignore-user-config",
    "-c", "features.apps=false",
    "-c", "features.shell_snapshot=false",
  ];
  const env: Record<string, string> = {};
  if (endpoint) {
    const headerVars: string[] = [];
    for (const [header, value] of Object.entries(endpoint.headers)) {
      const name = brokerHeaderEnvName(header);
      if (name in env) throw new Error(`Broker headers ${JSON.stringify(header)} and another map to one variable, ${name}`);
      env[name] = value;
      headerVars.push(`${tomlString(header)}=${tomlString(name)}`);
    }
    const server = `mcp_servers.${SIDECAR_BROKER_NAME}`;
    configFlags.push(
      "-c", `${server}.url=${tomlString(endpoint.url)}`,
      "-c", `${server}.required=true`,
      "-c", `${server}.default_tools_approval_mode="approve"`,
      "-c", `${server}.startup_timeout_sec=${SIDECAR_CODEX_STARTUP_TIMEOUT_SEC}`,
      "-c", `${server}.tool_timeout_sec=${Math.max(1, Math.ceil(idleMs / 1000))}`,
      "-c", `${server}.env_http_headers={${headerVars.join(", ")}}`,
    );
  }
  return {
    codex: {
      policyFlags: compileCodexPolicyFlags(SIDECAR_CODEX_POLICY),
      resumePolicyFlags: compileCodexPolicyFlags(SIDECAR_CODEX_POLICY, { resume: true }),
      configFlags,
      turnConfigFlags: () => sidecarCodexProjectFlags(cwd),
      hiddenEnv: Object.keys(env),
    },
    env,
  };
}

/** Inputs for the host-audited hub profile. Never read from project config. */
export interface CodexHubCandidateOptions {
  cwd: string;
  /** A dedicated, broker-produced snapshot file, never the session/credential directory. */
  snapshot: string;
  /** Explicit denials supplement root denial, whose native semantics need host verification. */
  repositories: readonly string[];
  /** Version observed from the selected executable, not a configured version hint. */
  version: string;
  platform: NodeJS.Platform;
}

/**
 * The host-audited profile, shared by production admission and the host fixture.
 * Reuses the production broker transport and secret masking. The permission
 * profile replaces (never combines with) legacy read-only flags on fresh and
 * resumed turns. Every turn rechecks path identity before invoking the CLI.
 * Only the supplied macOS version has native filesystem, network and broker
 * lifecycle evidence. Browser validation remains a separate host acceptance.
 */
export function candidateCodexHubSpawn(
  endpoint: SidecarBrokerEndpoint,
  idleMs: number,
  options: CodexHubCandidateOptions,
): SidecarCodexSpawn {
  if (hubVendorRefusal("codex", options)) {
    throw new Error("Codex hub candidate requires macOS codex-cli 0.167.0-alpha.3.2; other versions/platforms are unverified");
  }
  if (!options.repositories.length) throw new Error("Codex hub candidate requires explicit repository denials");
  const paths = [options.cwd, options.snapshot, ...options.repositories];
  if (paths.some((path) => !isAbsolute(path) || /[\x00-\x1f\x7f]/.test(path))) {
    throw new Error("Codex hub candidate paths must be absolute and contain no control characters");
  }
  const canonical = paths.map((path) => realpathSync(path));
  const [cwd, snapshot] = canonical as [string, string, ...string[]];
  const inside = (parent: string, child: string): boolean => {
    const tail = relative(parent, child);
    return tail === "" || (!isAbsolute(tail) && tail !== ".." && !tail.startsWith(`..${sep}`));
  };
  if (canonical.slice(2).some((repo) => inside(repo, cwd) || inside(repo, snapshot))) {
    throw new Error("Codex hub candidate workspace and snapshot must be outside every denied repository");
  }
  const checkPaths = (): void => {
    if (paths.some((path, index) => realpathSync(path) !== canonical[index])) {
      throw new Error("Codex hub candidate path identity changed; refusing the turn");
    }
    const file = lstatSync(options.snapshot);
    if (!file.isFile() || file.nlink !== 1 || !lstatSync(cwd).isDirectory()
        || canonical.slice(2).some((repo) => !lstatSync(repo).isDirectory())) {
      throw new Error("Codex hub candidate requires a regular unlinked snapshot and repository directories");
    }
  };
  checkPaths();
  const filesystem: Record<string, string> = {
    ":root": "deny", ":minimal": "read", ":tmpdir": "deny", ":slash_tmp": "deny",
  };
  for (const path of [...paths.slice(2), ...canonical.slice(2)]) filesystem[path] = "deny";
  // Grant just one file. A hub directory also contains transcripts, cards and
  // broker credentials; granting it would disclose more than the snapshot.
  filesystem[snapshot] = "read";
  const table = `{${Object.entries(filesystem).map(([key, value]) => `${tomlString(key)}=${tomlString(value)}`).join(",")}}`;
  const flags = [
    "--strict-config", "-c", 'approval_policy="never"',
    "-c", 'default_permissions="ndx-hub-candidate"',
    "-c", `permissions.ndx-hub-candidate.filesystem=${table}`,
    "-c", "permissions.ndx-hub-candidate.network.enabled=false",
  ];
  const spawn = sidecarCodexSpawn(endpoint, idleMs, cwd);
  return {
    ...spawn,
    codex: {
      ...spawn.codex,
      policyFlags: [...flags],
      resumePolicyFlags: [...flags],
      configFlags: [...(spawn.codex.configFlags ?? []), "-c", 'web_search="disabled"'],
      turnConfigFlags: () => {
        checkPaths();
        return sidecarCodexProjectFlags(cwd);
      },
    },
  };
}

/**
 * The MCP server a tool use or result names, when it is not the broker:
 * `mcp__<server>__<tool>`, as both vendors' parsers name an MCP call (a Codex
 * `mcp_tool_call` item from its own `server` field). Undefined for the
 * broker, a built-in tool and any other event.
 *
 * The spawn flags keep every other server off; this is the backstop for a
 * server they missed, so a turn that reaches one is stopped.
 */
export function strayMcpServer(event: RuntimeEvent): string | undefined {
  const tool = event.type === "tool_use" ? event.toolCall?.tool : event.type === "tool_result" ? event.toolResult?.tool : undefined;
  if (!tool?.startsWith("mcp__") || tool.startsWith(`mcp__${SIDECAR_BROKER_NAME}__`)) return undefined;
  const rest = tool.slice("mcp__".length);
  const end = rest.indexOf("__");
  return end > 0 ? rest.slice(0, end) : rest;
}

/** Why a turn that reached MCP server `server` was stopped, as the operator reads it. */
export function strayMcpStopReason(server: string): string {
  return `Stopped this turn: the agent used MCP server ${JSON.stringify(server)}, but a Sidecar session may reach only ${SIDECAR_BROKER_NAME}. Check the repository's .codex/config.toml for a server n-dx did not turn off.`;
}

/** A TOML basic string. JSON's escapes are a subset of TOML's for a basic string. */
function tomlString(value: string): string {
  return JSON.stringify(value);
}

/**
 * The vendor flags every Sidecar turn runs with; a hub-scope session gets no
 * built-in tool. `codex` is {@link sidecarCodexSpawn}'s flags.
 */
export function sidecarSpawnFlags(
  mcpConfigPath: string,
  scope: SidecarScope,
  codex: CodexTurnFlags,
): { claude: ClaudeTurnFlags; codex: CodexTurnFlags } {
  return {
    claude: {
      tools: scope === "hub" ? HUB_SIDECAR_TOOLS : SIDECAR_READ_TOOLS,
      settingSources: [],
      mcpConfigPath,
      allowedTools: [`mcp__${SIDECAR_BROKER_NAME}`],
    },
    codex,
  };
}
