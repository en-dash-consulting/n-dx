/**
 * The external MCP servers an operator has added, read from config.
 *
 * Connections are declared only in the untracked `.n-dx.local.json`, under
 * `connections`. A connection names a command to spawn or a URL a stored token
 * is sent to, so a cloned repository must never choose one: a `connections`
 * block in the tracked `.n-dx.json`, or in a `.n-dx.local.json` the repository
 * commits, is ignored with one warning. Config never holds a secret; a token
 * lives in the credential store (connection-credentials.ts).
 *
 * See docs/architecture/sidecar-connections.md.
 */

import { existsSync, readFileSync } from "node:fs";
import { isLocalConfigTracked, resolveLayout } from "@n-dx/llm-client";

/** A connection id: also the tool namespace, so it must fit a tool name. */
export const CONNECTION_ID_PATTERN = /^[a-z][a-z0-9-]{0,30}$/;

export type ConnectionAuth = "none" | "token" | "oauth";

/**
 * How an external-call card fills a picker for one property: from the
 * `path` (dotted keys; empty for the result itself) of a read tool's result,
 * or, with `auto`, from the connection's read tool the property's name points
 * at (`ownerId` → `list_owners`, `list_owner` or `owners`). `arguments` are
 * literal arguments for that read (a page size, say); with none it gets `{}`. With no hint a
 * property is a plain field.
 */
export type FieldHint = { optionsFrom: { tool: string; path: string; arguments?: Record<string, unknown> } } | { auto: true };

/** Hints by the property name of a write tool's input. */
export type FieldHints = Record<string, FieldHint>;

interface ConnectionBase {
  id: string;
  /** What the operator calls it; the id when unset. */
  label: string;
  auth: ConnectionAuth;
  /** Pickers for write-card properties; unset when the connection has none. They win over the profile's. */
  fieldHints?: FieldHints;
  /**
   * The server profile it uses, by name: data that adds per-tool field hints
   * (and, for a tracker, a mapping). Only the name is read here; whoever uses
   * the profile loads it and checks it against the server's tool list.
   */
  profile?: string;
  /**
   * Per-tool class and policy overrides, as written. tool-policy.ts checks them
   * against the server's tool list and warns about each bad entry.
   */
  tools?: unknown;
}

/** A streamable HTTP server. */
export interface HttpConnectionConfig extends ConnectionBase {
  transport: "http";
  url: string;
}

/** A local server spawned over stdio. Always `auth: "none"`. */
export interface StdioConnectionConfig extends ConnectionBase {
  transport: "stdio";
  command: string;
  args: string[];
  /** Literal variables added to the sanitized child environment. */
  env: Record<string, string>;
  auth: "none";
}

export type ConnectionConfig = HttpConnectionConfig | StdioConnectionConfig;

export interface LoadConnectionsOptions {
  /** Where warnings go. Defaults to stderr. */
  warn?: (message: string) => void;
}

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined;
}

function readJson(path: string, warn: (message: string) => void): Json | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return asRecord(JSON.parse(readFileSync(path, "utf-8")));
  } catch (err) {
    warn(`[connections] Could not read ${path}: ${(err as Error).message}; no connections loaded from it.`);
    return undefined;
  }
}

/** Files already warned about, so a server that loads config often warns once per file. */
const warned = new Set<string>();

function warnOnce(key: string, message: string, warn: (message: string) => void): void {
  if (warned.has(key)) return;
  warned.add(key);
  warn(message);
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const out: Record<string, string> = {};
  for (const [name, item] of Object.entries(record)) {
    if (typeof item !== "string") return undefined;
    out[name] = item;
  }
  return out;
}

/** `raw` as hints; an entry that is not one is left out and named in `skipped`. */
export function parseFieldHints(raw: unknown, skipped: string[]): FieldHints | undefined {
  if (raw === undefined) return undefined;
  const block = asRecord(raw);
  if (!block) {
    skipped.push("fieldHints must be an object keyed by property name");
    return undefined;
  }
  const out: FieldHints = {};
  for (const [property, value] of Object.entries(block)) {
    const hint = asRecord(value);
    const from = asRecord(hint?.optionsFrom);
    if (hint?.auto === true) out[property] = { auto: true };
    else if (
      from && typeof from.tool === "string" && from.tool &&
      (from.path === undefined || typeof from.path === "string") &&
      (from.arguments === undefined || asRecord(from.arguments))
    ) {
      const args = asRecord(from.arguments);
      out[property] = { optionsFrom: { tool: from.tool, path: from.path ?? "", ...(args ? { arguments: args } : {}) } };
    } else {
      skipped.push(`the field hint for ${JSON.stringify(property)} must be { "auto": true } or { "optionsFrom": { "tool", "path", "arguments"? } }`);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** One entry as a connection, or the reason it is not one. */
function parseConnection(id: string, raw: unknown, warnHint: (message: string) => void): ConnectionConfig | string {
  if (!CONNECTION_ID_PATTERN.test(id)) return `its id must match ${CONNECTION_ID_PATTERN}`;
  const entry = asRecord(raw);
  if (!entry) return "it is not an object";
  const auth = entry.auth ?? "none";
  if (auth !== "none" && auth !== "token" && auth !== "oauth") return `auth must be "none", "token" or "oauth"`;
  const label = typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : id;
  const skippedHints: string[] = [];
  const fieldHints = parseFieldHints(entry.fieldHints, skippedHints);
  for (const reason of skippedHints) warnHint(reason);
  const profile = typeof entry.profile === "string" ? entry.profile.trim() : undefined;
  if (entry.profile !== undefined && !profile) warnHint("profile must be a non-empty string naming a server profile");
  const extras = { ...(fieldHints && { fieldHints }), ...(profile && { profile }) };

  if (entry.transport === "http") {
    if (typeof entry.url !== "string") return "an http connection needs a url";
    let url: URL;
    try {
      url = new URL(entry.url);
    } catch {
      return "its url is not a valid URL";
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return "its url must be http or https";
    if (url.username || url.password) return "its url must not carry credentials; use auth \"token\"";
    return { id, label, auth, tools: entry.tools, ...extras, transport: "http", url: url.href };
  }

  if (entry.transport === "stdio") {
    // MCP authorization is HTTP-only; a stdio server never receives a token.
    if (auth !== "none") return "a stdio connection takes auth \"none\" only";
    if (typeof entry.command !== "string" || !entry.command.trim()) return "a stdio connection needs a command";
    const args = entry.args ?? [];
    if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) return "args must be a list of strings";
    const env = entry.env === undefined ? {} : stringRecord(entry.env);
    if (!env) return "env must map names to string values";
    return { id, label, auth: "none", tools: entry.tools, ...extras, transport: "stdio", command: entry.command, args, env };
  }

  return `transport must be "http" or "stdio"`;
}

/**
 * The connections `projectDir` declares, in config order. An invalid entry is
 * skipped with a warning naming it; a repository-controlled block is ignored.
 */
export function loadConnections(projectDir: string, options: LoadConnectionsOptions = {}): ConnectionConfig[] {
  const warn = options.warn ?? ((message: string) => process.stderr.write(message + "\n"));
  const { configFile, localConfigFile } = resolveLayout(projectDir);

  if (readJson(configFile, warn)?.connections !== undefined) {
    warnOnce(
      `${configFile}\0tracked`,
      `[connections] Ignoring the connections block in ${configFile}: a repository's config cannot choose ` +
        "a server to spawn or where a token is sent. Declare connections in .n-dx.local.json.",
      warn,
    );
  }

  const local = readJson(localConfigFile, warn);
  if (local?.connections === undefined) return [];
  if (isLocalConfigTracked(projectDir)) {
    warnOnce(
      `${localConfigFile}\0tracked`,
      `[connections] Ignoring the connections block in ${localConfigFile}: the repository commits that file, ` +
        "so it is not your own config here.",
      warn,
    );
    return [];
  }

  const block = asRecord(local.connections);
  if (!block) {
    warnOnce(`${localConfigFile}\0shape`, `[connections] connections in ${localConfigFile} must be an object; ignored.`, warn);
    return [];
  }

  const out: ConnectionConfig[] = [];
  for (const [id, raw] of Object.entries(block)) {
    const parsed = parseConnection(id, raw, (reason) =>
      warnOnce(`${localConfigFile}\0${id}\0${reason}`, `[connections] Connection "${id}": ${reason}; ignored.`, warn));
    if (typeof parsed === "string") {
      warnOnce(`${localConfigFile}\0${id}\0${parsed}`, `[connections] Skipping connection "${id}": ${parsed}.`, warn);
    } else {
      out.push(parsed);
    }
  }
  return out;
}
