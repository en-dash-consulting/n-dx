/**
 * What an external-call card carries beyond the agent's arguments, and what
 * its result adds back.
 *
 * Before the card is raised, `buildExternalCall` names the connection and
 * workspace host, copies the tool's input schema for the form, and fills a
 * picker for each property the connection's field hints name, from a read
 * tool of the same connection. A hint that cannot be filled (the tool is not a
 * listed read tool, the call fails or answers something else) leaves its
 * property a plain field; the card is never held up on it.
 *
 * After the call, `callProblems` reads a validation error's problems list so
 * the card can show it. The result itself reaches the session unchanged.
 *
 * Nothing here is specific to any tracker: hints and tool names come from the
 * operator's connection config, the server profile it names (data, checked
 * against the server's tool list in tracker/server-profiles.ts) and the
 * server's own tool list.
 *
 * See docs/architecture/sidecar-connections.md.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { SidecarCallProblem, SidecarExternalCall, SidecarFieldOption } from "../../shared/index.js";
import type { FieldHint, FieldHints } from "../connections/connection-config.js";
import type { ConnectionService, ConnectionTool } from "../connections/connection-service.js";
import { profileFieldHints, type ProfileOptions } from "../tracker/server-profiles.js";

/** The longest a picker's list is drawn; a longer result is cut. */
export const MAX_FIELD_OPTIONS = 200;
/** How long a hint's read tool may take before its property falls back to a plain field. */
export const HINT_READ_TIMEOUT_MS = 5_000;
/** The most problems a card keeps, and the longest one. */
const MAX_PROBLEMS = 50;
const MAX_PROBLEM_LENGTH = 500;

/** The properties whose value an approval cannot change: an idempotency key the agent chose. */
export const IDEMPOTENCY_KEY_PROPERTIES: readonly string[] = ["requestId", "idempotencyKey"];

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);

/** A result's data: its structured content, else its first text block parsed as JSON. */
export function resultData(result: CallToolResult): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;
  for (const block of result.content ?? []) {
    if (block.type !== "text") continue;
    try {
      return JSON.parse(block.text) as unknown;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** `path` (dotted keys; empty for the root) into `data`. */
function at(data: unknown, path: string): unknown {
  let current = data;
  for (const key of path.split(".").filter(Boolean)) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

const isScalar = (value: unknown): value is string | number | boolean =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean";

/** The choices an array lists: scalars as they are, objects by their id/value/key and name/title/label. */
function optionsOf(list: unknown): SidecarFieldOption[] {
  if (!Array.isArray(list)) return [];
  const out: SidecarFieldOption[] = [];
  for (const item of list) {
    if (isScalar(item)) out.push({ value: item, label: String(item) });
    else if (isRecord(item)) {
      const value = [item.id, item.value, item.key].find(isScalar);
      if (value === undefined) continue;
      const label = [item.name, item.title, item.label].find((v): v is string => typeof v === "string" && v !== "");
      out.push({ value, label: label ?? String(value) });
    }
    if (out.length >= MAX_FIELD_OPTIONS) break;
  }
  return out;
}

/** Candidate read-tool names for an `auto` hint: `ownerId` → `list_owners`, `list_owner`, `owners`. */
function autoToolNames(property: string): string[] {
  const base = property
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/_?ids?$/, "");
  return base ? [`list_${base}s`, `list_${base}`, `${base}s`] : [];
}

/** The list an `auto` hint reads: the result itself when it is a list, else its first list-valued property. */
function autoList(data: unknown): unknown {
  if (Array.isArray(data)) return data;
  return isRecord(data) ? Object.values(data).find(Array.isArray) : undefined;
}

/**
 * The choices for one property, or none. Only a read-class tool of the same
 * connection whose policy is `run` is called, with the hint's literal arguments (none by default).
 */
async function readOptions(
  property: string,
  hint: FieldHint,
  tools: readonly ConnectionTool[],
  connection: string,
  connections: Pick<ConnectionService, "callTool">,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<SidecarFieldOption[]> {
  // Only a read that runs without asking: a hint never makes a call the operator would be asked about.
  const readTools = tools.filter((t) => t.connection === connection && t.policy.class === "read" && t.policy.policy === "run");
  const tool = "auto" in hint
    ? autoToolNames(property).map((name) => readTools.find((t) => t.tool === name)).find((t) => t !== undefined)
    : readTools.find((t) => t.tool === hint.optionsFrom.tool);
  if (!tool) return [];
  // The limit stops waiting; it does not abort the read, which finishes, or meets the service's
  // own call timeout, alone. Only the card's own signal (a stopped turn) aborts it.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<"expired">((resolve) => { timer = setTimeout(() => resolve("expired"), timeoutMs); });
  const args = "optionsFrom" in hint ? hint.optionsFrom.arguments ?? {} : {};
  const read = connections.callTool(connection, tool.tool, args, signal);
  // Nobody awaits a read that outlives the limit; its failure is not the card's.
  read.catch(() => undefined);
  try {
    const result = await Promise.race([read, expired]);
    if (result === "expired" || result.isError) return [];
    const data = resultData(result);
    return optionsOf("auto" in hint ? autoList(data) : at(data, hint.optionsFrom.path));
  } catch {
    // A hint is an aid: an unreachable server or a malformed result leaves a plain field.
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The hints for `tool`'s card: the connection's server profile's hints for the
 * tool, when the profile fits the server, under the connection's own hints,
 * which win for the same property.
 */
function cardHints(
  tool: ConnectionTool,
  tools: readonly ConnectionTool[],
  context: ReturnType<ConnectionService["callContext"]>,
  options: ProfileOptions,
): FieldHints {
  const own = context?.fieldHints ?? {};
  if (!context?.profile) return own;
  const serverTools = tools.filter((t) => t.connection === tool.connection);
  return { ...profileFieldHints(context.profile, tool.tool, serverTools, options), ...own };
}

/** The card's connection, workspace, schema and picker choices for `tool`. */
export async function buildExternalCall(
  tool: ConnectionTool,
  tools: readonly ConnectionTool[],
  connections: Pick<ConnectionService, "callContext" | "callTool">,
  signal?: AbortSignal,
  settings: { hintTimeoutMs?: number } & ProfileOptions = {},
): Promise<SidecarExternalCall> {
  const timeoutMs = settings.hintTimeoutMs ?? HINT_READ_TIMEOUT_MS;
  const context = connections.callContext(tool.connection);
  const inputSchema = tool.inputSchema as Json;
  const properties = isRecord(inputSchema.properties) ? inputSchema.properties : {};
  const hints = cardHints(tool, tools, context, settings);
  const named = Object.entries(hints).filter(([property]) => property in properties);
  const read = await Promise.all(
    named.map(async ([property, hint]) => [property, await readOptions(property, hint, tools, tool.connection, connections, signal, timeoutMs)] as const),
  );
  const options = Object.fromEntries(read.filter(([, list]) => list.length > 0));
  return {
    label: context?.label ?? tool.connection,
    ...(context?.host && { host: context.host }),
    inputSchema,
    ...(Object.keys(options).length > 0 && { options }),
  };
}

/** The idempotency key an arguments object carries: the first of the key properties set to a scalar. */
export function idempotencyKeyOf(args: Json): { name: string; value: string | number | boolean } | undefined {
  for (const name of IDEMPOTENCY_KEY_PROPERTIES) {
    const value = args[name];
    if (isScalar(value)) return { name, value };
  }
  return undefined;
}

/** One problem entry as a line: a string as it is, an object by its path/field and message. */
function problemOf(entry: unknown): SidecarCallProblem {
  if (typeof entry === "string") return { message: entry.slice(0, MAX_PROBLEM_LENGTH) };
  if (isRecord(entry)) {
    const message = [entry.message, entry.error, entry.detail, entry.reason].find((v): v is string => typeof v === "string" && v !== "");
    const rawField = [entry.field, entry.path, entry.property, entry.name].find((v) => typeof v === "string" || Array.isArray(v));
    const field = Array.isArray(rawField) ? rawField.map(String).join(".") : rawField;
    return {
      ...(typeof field === "string" && field && { field: field.slice(0, MAX_PROBLEM_LENGTH) }),
      message: (message ?? JSON.stringify(entry)).slice(0, MAX_PROBLEM_LENGTH),
    };
  }
  return { message: JSON.stringify(entry).slice(0, MAX_PROBLEM_LENGTH) };
}

/**
 * The problems an error result lists: the `problems` array of its structured
 * content or JSON text (a server's `error: "validation_failed"` answer carries
 * one). Empty for a success, an error with no list, or anything else; the
 * result is only read, never altered.
 */
export function callProblems(result: CallToolResult): SidecarCallProblem[] {
  if (!result.isError) return [];
  const data = resultData(result);
  if (!isRecord(data) || !Array.isArray(data.problems)) return [];
  return data.problems.slice(0, MAX_PROBLEMS).map(problemOf);
}
