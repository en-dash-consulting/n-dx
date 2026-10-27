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
 * **Codex.** A read-only sandbox that never asks for approval. A resumed
 * thread keeps the policy it started with.
 */

import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileCodexPolicyFlags } from "@n-dx/llm-client";
import type { ClaudeTurnFlags, CodexTurnFlags, ExecutionPolicy } from "@n-dx/llm-client";
import { SIDECAR_BROKER_NAME } from "./broker-policy.js";
import { ensureSidecarDir } from "./sidecar-dir.js";

/** The built-in Claude tools a Sidecar session keeps: reads only. */
export const SIDECAR_READ_TOOLS = ["Read", "Grep", "Glob"] as const;

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

/** The vendor flags every Sidecar turn runs with. */
export function sidecarSpawnFlags(mcpConfigPath: string): { claude: ClaudeTurnFlags; codex: CodexTurnFlags } {
  return {
    claude: {
      tools: SIDECAR_READ_TOOLS,
      settingSources: [],
      mcpConfigPath,
      allowedTools: [`mcp__${SIDECAR_BROKER_NAME}`],
    },
    codex: {
      policyFlags: compileCodexPolicyFlags(SIDECAR_CODEX_POLICY),
    },
  };
}
