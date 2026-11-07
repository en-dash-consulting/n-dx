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
 *   them and never replaces them). Auth still comes from `CODEX_HOME`.
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
 * - `-c mcp_servers.<name>.enabled=false` for every server a repository's own
 *   `.codex/config.toml` declares, from the session's checkout up to the
 *   repository root, re-read for each turn ({@link sidecarCodexProjectFlags}):
 *   `--ignore-user-config` does not skip project config. A file that exists
 *   but cannot be read with confidence refuses the turn before anything is
 *   spawned.
 *
 * **Hub scope.** The hub session works from the hub snapshot and must not
 * read any repository, so its Claude spawn gets no built-in tool at all
 * (`--tools ""`): the broker is all it has. Codex cannot be confined that
 * far — its read-only sandbox still reads every file — so a hub session is
 * Claude-only ({@link hubVendorRefusal}).
 */

import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CodexProjectConfigError, codexProjectMcpDisableFlags, compileCodexPolicyFlags } from "@n-dx/llm-client";
import type { ClaudeTurnFlags, CodexTurnFlags, ExecutionPolicy } from "@n-dx/llm-client";
import { SIDECAR_BROKER_NAME } from "./broker-policy.js";
import type { SidecarScope } from "./context-refresh.js";
import { ensureSidecarDir } from "./sidecar-dir.js";

/** The built-in Claude tools a Sidecar session keeps: reads only. */
export const SIDECAR_READ_TOOLS = ["Read", "Grep", "Glob"] as const;

/** The built-in Claude tools a hub-scope session keeps: none. */
export const HUB_SIDECAR_TOOLS: readonly string[] = [];

/** Why a hub-scope session cannot run on `vendor`, or null when it can. */
export function hubVendorRefusal(vendor: string): string | null {
  if (vendor === "claude") return null;
  if (vendor === "codex") {
    return "A hub session cannot run on Codex: its read-only sandbox can still read repositories, and the hub session works from the hub snapshot alone";
  }
  return `A hub session runs on Claude only, not "${vendor}"`;
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
