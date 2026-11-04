/**
 * MCP client to the servers an operator adds (connection-config.ts).
 *
 * One live client per connection for the service's life, connected lazily on
 * first use. A failure — refused, timed out, exited, closed — marks the
 * connection unavailable with its reason, never touches the others, and drops
 * the client so the next use reconnects. Each connection's tools/list is
 * cached and re-read on reconnect and on `notifications/tools/list_changed`.
 *
 * A tool is offered as `<id>.<tool>` and carried on the wire as
 * `<id>__<tool>`: Claude's and OpenAI's tool-name patterns reject dots, and an
 * id never holds `_`, so the first `__` splits a wire name unambiguously.
 *
 * Nothing here knows any particular server: no tracker, tool or status name.
 * See docs/architecture/sidecar-connections.md.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  ErrorCode,
  McpError,
  ToolListChangedNotificationSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { compileEnvPolicy, sanitizeChildEnv, type CredentialStoreOptions } from "@n-dx/llm-client";
import { errorMessage } from "../response-utils.js";
import { loadConnections, type ConnectionConfig } from "./connection-config.js";
import { connectionToken } from "./connection-credentials.js";
import { resolveToolPolicies, type ToolPolicy } from "./tool-policy.js";

/** The longest tool name the Claude and OpenAI tool APIs accept. */
export const MAX_WIRE_NAME_LENGTH = 64;
const WIRE_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const WIRE_SEPARATOR = "__";

export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
export const DEFAULT_CALL_TIMEOUT_MS = 60_000;

export type ConnectionState =
  | { state: "connected" }
  | { state: "unavailable"; reason: string }
  | { state: "needs-sign-in"; reason: string };

export interface ConnectionInfo {
  id: string;
  label: string;
  transport: ConnectionConfig["transport"];
  auth: ConnectionConfig["auth"];
  status: ConnectionState;
}

/** One external tool, as the broker offers it. */
export interface ConnectionTool {
  connection: string;
  tool: string;
  displayName: string;
  wireName: string;
  description: string;
  inputSchema: Tool["inputSchema"];
  annotations: Tool["annotations"];
  /** Read/write class and run/ask/never policy, each with where it came from. */
  policy: ToolPolicy;
}

/** Thrown by {@link ConnectionService.callTool} when the connection cannot be reached. */
export class ConnectionUnavailableError extends Error {
  constructor(readonly connection: string, readonly status: Exclude<ConnectionState, { state: "connected" }>) {
    super(
      status.state === "needs-sign-in"
        ? `connection ${connection} needs sign-in: ${status.reason}`
        : `connection unavailable: ${connection}: ${status.reason}`,
    );
    this.name = "ConnectionUnavailableError";
  }
}

export interface ConnectionServiceOptions {
  /** Where connections are declared and where a stdio server runs. */
  projectDir: string;
  /** The connections to use instead of reading config (tests). */
  connections?: ConnectionConfig[];
  /** Credential store options, e.g. a temp ndx home (tests). */
  credentials?: CredentialStoreOptions;
  connectTimeoutMs?: number;
  callTimeoutMs?: number;
  /** Where warnings go. Defaults to stderr. Never receives a credential value. */
  warn?: (message: string) => void;
}

/** The `<id>__<tool>` name a tool is carried under. */
export function connectionWireName(connection: string, tool: string): string {
  return `${connection}${WIRE_SEPARATOR}${tool}`;
}

/** A wire name split back into connection and tool, or undefined when it is not one. */
export function parseConnectionWireName(wireName: string): { connection: string; tool: string } | undefined {
  const at = wireName.indexOf(WIRE_SEPARATOR);
  if (at <= 0 || at + WIRE_SEPARATOR.length >= wireName.length) return undefined;
  return { connection: wireName.slice(0, at), tool: wireName.slice(at + WIRE_SEPARATOR.length) };
}

interface Live {
  client: Client;
  tools: ConnectionTool[];
}

interface Slot {
  config: ConnectionConfig;
  live?: Live;
  connecting?: Promise<Live | undefined>;
  status: ConnectionState;
}

function definedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

/** Whether `err` means the connection itself failed, not just one call. */
function isConnectionFailure(err: unknown): boolean {
  if (err instanceof McpError) return err.code === ErrorCode.ConnectionClosed || err.code === ErrorCode.RequestTimeout;
  return !(err instanceof Error && err.name === "AbortError");
}

export class ConnectionService {
  private readonly slots = new Map<string, Slot>();
  private readonly warn: (message: string) => void;
  private readonly connectTimeoutMs: number;
  private readonly callTimeoutMs: number;
  private readonly warnedNames = new Set<string>();
  private closed = false;

  constructor(private readonly options: ConnectionServiceOptions) {
    this.warn = options.warn ?? ((message: string) => process.stderr.write(message + "\n"));
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    const configs = options.connections ?? loadConnections(options.projectDir, { warn: this.warn });
    for (const config of configs) {
      this.slots.set(config.id, { config, status: { state: "unavailable", reason: "not connected yet" } });
    }
  }

  /** Every connection with its state, connecting any that is not live. */
  async listConnections(): Promise<ConnectionInfo[]> {
    await Promise.all([...this.slots.values()].map((slot) => this.ensure(slot)));
    return [...this.slots.values()].map(({ config, status }) => ({
      id: config.id,
      label: config.label,
      transport: config.transport,
      auth: config.auth,
      status,
    }));
  }

  /** Every reachable connection's tools; an unavailable connection contributes none. */
  async listTools(): Promise<ConnectionTool[]> {
    const lives = await Promise.all([...this.slots.values()].map((slot) => this.ensure(slot)));
    return lives.flatMap((live) => live?.tools ?? []);
  }

  /**
   * Call `tool` on `connection`. Throws {@link ConnectionUnavailableError} when
   * the connection cannot be reached; a failure mid-call marks it unavailable
   * so the next call reconnects. A tool's own error is its result's `isError`.
   */
  async callTool(
    connection: string,
    tool: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CallToolResult> {
    const slot = this.slots.get(connection);
    if (!slot) throw new Error(`No connection named ${connection}`);
    const live = await this.ensure(slot);
    if (!live) throw new ConnectionUnavailableError(connection, slot.status as Exclude<ConnectionState, { state: "connected" }>);
    try {
      return (await live.client.callTool({ name: tool, arguments: args }, undefined, {
        signal,
        timeout: this.callTimeoutMs,
      })) as CallToolResult;
    } catch (err) {
      if (isConnectionFailure(err)) {
        this.fail(slot, live, errorMessage(err));
        throw new ConnectionUnavailableError(connection, slot.status as Exclude<ConnectionState, { state: "connected" }>);
      }
      throw err;
    }
  }

  /** Close every client (and stop every stdio server). */
  async close(): Promise<void> {
    this.closed = true;
    const lives = [...this.slots.values()].flatMap((slot) => {
      const live = slot.live;
      slot.live = undefined;
      return live ? [live] : [];
    });
    await Promise.all(lives.map((live) => live.client.close().catch(() => undefined)));
  }

  private ensure(slot: Slot): Promise<Live | undefined> {
    if (slot.live) return Promise.resolve(slot.live);
    if (this.closed) return Promise.resolve(undefined);
    slot.connecting ??= this.connect(slot).finally(() => {
      slot.connecting = undefined;
    });
    return slot.connecting;
  }

  private transportFor(config: ConnectionConfig): Transport | ConnectionState {
    if (config.transport === "stdio") {
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        // The SDK adds its default variables (PATH, HOME, …) under these; the
        // sanitized copy keeps a credential-shaped name out of the child even
        // if that list grows one. Only the config's literal env is added.
        env: { ...definedEnv(sanitizeChildEnv(getDefaultEnvironment(), compileEnvPolicy(undefined))), ...config.env },
        cwd: this.options.projectDir,
        stderr: "ignore",
      });
    }
    const url = new URL(config.url);
    if (config.auth === "oauth") {
      // The OAuth sign-in (discovery, PKCE, refresh) arrives with task 49a.
      return { state: "needs-sign-in", reason: "OAuth sign-in is not available yet" };
    }
    if (config.auth === "token") {
      const token = connectionToken(config.id, this.options.credentials);
      if (!token) return { state: "needs-sign-in", reason: `no token stored as connection:${config.id}` };
      return new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
    }
    return new StreamableHTTPClientTransport(url);
  }

  private async connect(slot: Slot): Promise<Live | undefined> {
    const { config } = slot;
    const transport = this.transportFor(config);
    if (!("start" in transport)) {
      slot.status = transport;
      return undefined;
    }
    const client = new Client({ name: "n-dx-connections", version: "1.0.0" }, { capabilities: {} });
    try {
      await client.connect(transport, { timeout: this.connectTimeoutMs });
      const live: Live = { client, tools: await this.readTools(config.id, client) };
      // Any close after this point — the server exited, the stream dropped —
      // makes the connection unavailable until the next use reconnects.
      client.onclose = () => this.fail(slot, live, "the server closed the connection");
      client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        try {
          live.tools = await this.readTools(config.id, client);
        } catch (err) {
          this.fail(slot, live, errorMessage(err));
        }
      });
      if (this.closed) {
        await client.close().catch(() => undefined);
        return undefined;
      }
      slot.live = live;
      slot.status = { state: "connected" };
      return live;
    } catch (err) {
      await client.close().catch(() => undefined);
      slot.status =
        err instanceof StreamableHTTPError && err.code === 401
          ? {
              state: "needs-sign-in",
              reason: config.auth === "none" ? "the server requires sign-in; set auth to \"token\" or \"oauth\"" : "the server refused the stored token",
            }
          : { state: "unavailable", reason: errorMessage(err) };
      return undefined;
    }
  }

  private fail(slot: Slot, live: Live, reason: string): void {
    if (slot.live !== live) return;
    slot.live = undefined;
    slot.status = { state: "unavailable", reason };
    live.client.onclose = undefined;
    void live.client.close().catch(() => undefined);
  }

  private async readTools(connection: string, client: Client): Promise<ConnectionTool[]> {
    const found: Tool[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: this.connectTimeoutMs });
      for (const tool of page.tools) {
        const wireName = connectionWireName(connection, tool.name);
        if (wireName.length > MAX_WIRE_NAME_LENGTH || !WIRE_NAME_PATTERN.test(tool.name)) {
          if (!this.warnedNames.has(wireName)) {
            this.warnedNames.add(wireName);
            this.warn(
              `[connections] Skipping tool ${JSON.stringify(wireName)}: a tool name must be at most ` +
                `${MAX_WIRE_NAME_LENGTH} characters of letters, digits, "_" and "-".`,
            );
          }
          continue;
        }
        found.push(tool);
      }
      cursor = page.nextCursor;
    } while (cursor);
    const overrides = this.slots.get(connection)?.config.tools;
    // The connection is named so the same bad override on two connections warns for each.
    const policies = resolveToolPolicies(found, overrides, (message) => this.warnOnce(`${message} (connection ${connection})`));
    return found.map((tool) => ({
      connection,
      tool: tool.name,
      displayName: `${connection}.${tool.name}`,
      wireName: connectionWireName(connection, tool.name),
      description: tool.description ?? "",
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
      policy: policies.get(tool.name)!,
    }));
  }

  private warnOnce(message: string): void {
    if (this.warnedNames.has(message)) return;
    this.warnedNames.add(message);
    this.warn(message);
  }
}
