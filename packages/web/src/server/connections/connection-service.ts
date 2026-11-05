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
import {
  compileEnvPolicy,
  redactSecrets,
  sanitizeChildEnv,
  type CredentialStoreOptions,
} from "@n-dx/llm-client";
import { errorMessage } from "../response-utils.js";
import { InvalidGrantError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { loadConnections, type ConnectionConfig, type HttpConnectionConfig } from "./connection-config.js";
import { connectionToken, withoutConnectionToken } from "./connection-credentials.js";
import {
  ConnectionOAuth,
  ConnectionRefreshError,
  ConnectionSignInRequiredError,
  SIGN_IN_AGAIN,
} from "./oauth-provider.js";
import { resolveToolPolicies, type ToolPolicy } from "./tool-policy.js";

/** The longest tool name the Claude and OpenAI tool APIs accept. */
export const MAX_WIRE_NAME_LENGTH = 64;
const WIRE_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const WIRE_SEPARATOR = "__";

export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
export const DEFAULT_CALL_TIMEOUT_MS = 60_000;
/** After a failed connect, a listing waits this long before reconnecting; it doubles per failure up to the cap. */
export const DEFAULT_LIST_RETRY_MS = 30_000;
export const MAX_LIST_RETRY_MS = 300_000;

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
  /** First wait before a listing reconnects a connection that failed to connect. */
  listRetryMs?: number;
  /** The clock for that wait, in ms (tests). */
  now?: () => number;
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
  /** The tools last listed while connected, kept while the connection is unavailable. */
  known?: ConnectionTool[];
  connecting?: Promise<Live | undefined>;
  status: ConnectionState;
  /** Consecutive failed connects; reset by a successful one. */
  failures: number;
  /** Until this time (ms) a listing serves the slot as it is instead of reconnecting. */
  retryAt?: number;
}

function definedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

/** Whether `err` means the connection itself failed, not just one call. */
function isConnectionFailure(err: unknown): boolean {
  if (err instanceof McpError) return err.code === ErrorCode.ConnectionClosed || err.code === ErrorCode.RequestTimeout;
  return !(err instanceof Error && err.name === "AbortError");
}

/** The longest reason kept: a status line plus a short server message. */
const MAX_REASON_LENGTH = 300;

export class ConnectionService {
  private readonly slots = new Map<string, Slot>();
  private readonly warn: (message: string) => void;
  private readonly connectTimeoutMs: number;
  private readonly callTimeoutMs: number;
  private readonly listRetryMs: number;
  private readonly now: () => number;
  private readonly warnedNames = new Set<string>();
  private readonly oauth: ConnectionOAuth;
  private closed = false;

  constructor(private readonly options: ConnectionServiceOptions) {
    this.warn = options.warn ?? ((message: string) => process.stderr.write(message + "\n"));
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    this.listRetryMs = options.listRetryMs ?? DEFAULT_LIST_RETRY_MS;
    this.now = options.now ?? Date.now;
    this.oauth = new ConnectionOAuth({ credentials: options.credentials, now: this.now });
    const configs = options.connections ?? loadConnections(options.projectDir, { warn: this.warn });
    for (const config of configs) {
      this.slots.set(config.id, { config, status: { state: "unavailable", reason: "not connected yet" }, failures: 0 });
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

  /** Whether any connection is declared. */
  hasConnections(): boolean {
    return this.slots.size > 0;
  }

  /**
   * Every connection's tools, connecting any that is not live. A connection
   * that went unavailable keeps the tools it last listed, so a session's tool
   * list does not shift under it and a call reads why it cannot run; one that
   * was never reached contributes none. `only` limits it to those connections,
   * so a call to one never waits on connecting another. A connection whose
   * connect failed is not retried until its retry interval has passed (30 s,
   * doubling to 5 min), so a server that hangs does not delay every listing by
   * the connect timeout; a call to it still reconnects at once.
   */
  async listTools(only?: readonly string[]): Promise<ConnectionTool[]> {
    const slots = [...this.slots.values()].filter((slot) => !only || only.includes(slot.config.id));
    await Promise.all(slots.map((slot) => (this.backingOff(slot) ? undefined : this.ensure(slot))));
    return slots.flatMap((slot) => slot.live?.tools ?? slot.known ?? []);
  }

  /**
   * Whether `connection` answers now: connects it if it is not live, else
   * pings it, so a server that went away since the last call reads
   * unavailable before anything is asked of the operator.
   */
  async check(connection: string, signal?: AbortSignal): Promise<ConnectionState> {
    const slot = this.slots.get(connection);
    if (!slot) return { state: "unavailable", reason: `no connection named ${connection}` };
    const live = await this.ensure(slot);
    if (!live) return slot.status;
    try {
      await live.client.ping({ signal, timeout: this.connectTimeoutMs });
    } catch (err) {
      if (!isConnectionFailure(err)) throw err;
      this.fail(slot, live, err);
    }
    return slot.status;
  }

  /**
   * Call `tool` on `connection`. Throws {@link ConnectionUnavailableError} when
   * the connection cannot be reached; a failure mid-call marks it unavailable
   * (needs-sign-in for a refused token) so the next call reconnects. A tool's
   * own error is its result's `isError`.
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
        this.fail(slot, live, err);
        throw new ConnectionUnavailableError(connection, slot.status as Exclude<ConnectionState, { state: "connected" }>);
      }
      throw err;
    }
  }

  /**
   * Start an OAuth sign-in for `connection`: the authorization URL to send the
   * user to, which returns to `redirectUrl`. The server opens no browser.
   */
  async beginSignIn(connection: string, redirectUrl: string): Promise<string> {
    return this.oauth.beginSignIn(this.oauthConfig(connection), redirectUrl);
  }

  /**
   * Finish `connection`'s sign-in with the redirect's `code` and `state`, then
   * reconnect it. Throws ConnectionSignInError, storing nothing, for a state
   * that is wrong, reused or expired.
   */
  async finishSignIn(connection: string, code: string, state: string): Promise<ConnectionState> {
    await this.oauth.finishSignIn(this.oauthConfig(connection), code, state);
    const slot = this.slots.get(connection)!;
    this.reset(slot, { state: "unavailable", reason: "not connected yet" });
    await this.ensure(slot);
    return slot.status;
  }

  /** Forget `connection`'s OAuth registration and tokens and drop its client. */
  async signOut(connection: string): Promise<ConnectionState> {
    this.oauth.signOut(this.oauthConfig(connection));
    const slot = this.slots.get(connection)!;
    this.reset(slot, { state: "needs-sign-in", reason: "signed out" });
    return slot.status;
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

  private oauthConfig(connection: string): HttpConnectionConfig {
    const config = this.slots.get(connection)?.config;
    if (!config) throw new Error(`No connection named ${connection}`);
    if (config.transport !== "http" || config.auth !== "oauth") throw new Error(`Connection ${connection} does not use OAuth`);
    return config;
  }

  /** Drop a slot's client and backoff, so the next use connects afresh. */
  private reset(slot: Slot, status: ConnectionState): void {
    const live = slot.live;
    slot.live = undefined;
    slot.status = status;
    slot.failures = 0;
    slot.retryAt = undefined;
    if (live) {
      live.client.onclose = undefined;
      void live.client.close().catch(() => undefined);
    }
  }

  private backingOff(slot: Slot): boolean {
    return !slot.live && !slot.connecting && slot.retryAt !== undefined && this.now() < slot.retryAt;
  }

  private ensure(slot: Slot): Promise<Live | undefined> {
    if (slot.live) return Promise.resolve(slot.live);
    if (this.closed) return Promise.resolve(undefined);
    slot.connecting ??= this.connect(slot).finally(() => {
      slot.connecting = undefined;
    });
    return slot.connecting;
  }

  /** Why a connection failed: a 401 means sign in (again), anything else unavailable. */
  private failureStatus(config: ConnectionConfig, err: unknown): Exclude<ConnectionState, { state: "connected" }> {
    if (err instanceof ConnectionSignInRequiredError) return { state: "needs-sign-in", reason: err.reason };
    if (err instanceof InvalidGrantError && config.auth === "oauth") {
      // The refresh token was refused twice over; only a sign-in recovers.
      this.oauth.forgetTokens(config.id);
      return { state: "needs-sign-in", reason: SIGN_IN_AGAIN };
    }
    if (err instanceof StreamableHTTPError && err.code === 401) {
      const reason = config.auth === "none"
        ? "the server requires sign-in; set auth to \"token\" or \"oauth\""
        : config.auth === "oauth" ? `the server refused the signed-in token; ${SIGN_IN_AGAIN}` : "the server refused the stored token";
      return { state: "needs-sign-in", reason };
    }
    if (err instanceof ConnectionRefreshError) return { state: "unavailable", reason: this.scrubReason(config, err.message) };
    // The SDK's message may not carry the status, so name it first.
    const status = err instanceof StreamableHTTPError && err.code !== undefined ? `HTTP ${err.code}: ` : "";
    return { state: "unavailable", reason: this.scrubReason(config, status + errorMessage(err)) };
  }

  /**
   * A reason reaches listings and logs, and a server's error body can echo the
   * request headers. The connection's token becomes its fingerprint, anything
   * else secret-shaped is redacted and the length is capped; the leading
   * "HTTP <status>" survives, so the operator can still diagnose the failure.
   */
  private scrubReason(config: ConnectionConfig, reason: string): string {
    const withoutToken = config.transport === "http" && config.auth !== "none"
      ? withoutConnectionToken(config.id, reason, this.options.credentials)
      : reason;
    const scrubbed = redactSecrets(withoutToken);
    return scrubbed.length > MAX_REASON_LENGTH ? `${scrubbed.slice(0, MAX_REASON_LENGTH)}…` : scrubbed;
  }

  private async transportFor(config: ConnectionConfig): Promise<Transport | ConnectionState> {
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
      // Headless: refreshes an expired token, never asks for a sign-in. The
      // transport also refreshes through the provider on a 401.
      const prepared = await this.oauth.prepare(config);
      if ("needsSignIn" in prepared) return { state: "needs-sign-in", reason: prepared.needsSignIn };
      return new StreamableHTTPClientTransport(url, { authProvider: prepared.provider });
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
    const client = new Client({ name: "n-dx-connections", version: "1.0.0" }, { capabilities: {} });
    try {
      const transport = await this.transportFor(config);
      if (!("start" in transport)) {
        slot.status = transport;
        return undefined;
      }
      await client.connect(transport, { timeout: this.connectTimeoutMs });
      const live: Live = { client, tools: await this.readTools(config.id, client) };
      // Any close after this point — the server exited, the stream dropped —
      // makes the connection unavailable until the next use reconnects.
      client.onclose = () => this.fail(slot, live, "the server closed the connection");
      client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        try {
          live.tools = await this.readTools(config.id, client);
          if (slot.live === live) slot.known = live.tools;
        } catch (err) {
          this.fail(slot, live, err);
        }
      });
      if (this.closed) {
        await client.close().catch(() => undefined);
        return undefined;
      }
      slot.live = live;
      slot.known = live.tools;
      slot.status = { state: "connected" };
      slot.failures = 0;
      slot.retryAt = undefined;
      return live;
    } catch (err) {
      await client.close().catch(() => undefined);
      slot.status = this.failureStatus(config, err);
      // A refused token answers at once and is fixed by storing a new one, so
      // only an unavailable server is backed off.
      if (slot.status.state === "unavailable") {
        slot.failures += 1;
        slot.retryAt = this.now() + Math.min(this.listRetryMs * 2 ** (slot.failures - 1), MAX_LIST_RETRY_MS);
      }
      return undefined;
    }
  }

  /** Drop a live client that failed; `failure` is the error or a reason. A refused token reads needs-sign-in. */
  private fail(slot: Slot, live: Live, failure: unknown): void {
    if (slot.live !== live) return;
    slot.live = undefined;
    slot.status = typeof failure === "string" ? { state: "unavailable", reason: failure } : this.failureStatus(slot.config, failure);
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
