/**
 * The edits Settings makes to the `connections` block of `.n-dx.local.json`:
 * add, remove, set a tool's class or policy, name a server profile. Each goes
 * through updateLocalConfigBlock, so it lands in the untracked local file and
 * nowhere else. A secret never passes through here: a token goes to the
 * credential store (connection-credentials.ts), and an entry holds none.
 *
 * Nothing here knows any particular server.
 */

import { updateLocalConfigBlock } from "../local-config-write.js";
import { CONNECTION_ID_PATTERN, parseConnection, type ConnectionConfig } from "./connection-config.js";
import { TOOL_CLASSES, TOOL_POLICIES } from "./tool-policy.js";

/** An edit that cannot be made; `status` is the HTTP status it deserves and `message` is safe to show. */
export class ConnectionWriteError extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string) {
    super(message);
    this.name = "ConnectionWriteError";
  }
}

/** Ids that would collide with a fixed path under /api/connections. */
export const RESERVED_CONNECTION_IDS: ReadonlySet<string> = new Set(["test", "sync", "tracker", "profiles"]);

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);

/**
 * `body` (what the add form posts) as a connection, or why it is not one:
 * `{ id, label?, transport, auth?, url | command, args?, env?, profile? }`
 * checked by the same parser that loads config, so a form cannot save what
 * the loader would skip.
 */
export function connectionFromForm(body: Json): ConnectionConfig | string {
  const id = body.id;
  if (typeof id !== "string" || !CONNECTION_ID_PATTERN.test(id)) return `"id" must match ${CONNECTION_ID_PATTERN}`;
  if (RESERVED_CONNECTION_IDS.has(id)) return `"${id}" is reserved; choose another id`;
  const { id: _id, ...entry } = body;
  const parsed = parseConnection(id, entry, () => undefined);
  if (typeof parsed === "string") return parsed;
  // The loader warns about a bad hint or profile and goes on; a form refuses.
  if (entry.profile !== undefined && (typeof entry.profile !== "string" || !entry.profile.trim())) return `"profile" must name a server profile`;
  return parsed;
}

/** `config` as the entry stored under its id: no id, and no label when it is the id. */
function entryOf(config: ConnectionConfig): Json {
  const { id, label, ...rest } = config;
  return JSON.parse(JSON.stringify({ ...(label !== id && { label }), ...rest })) as Json;
}

/** Declare `config`. Throws a 409 when the id is already declared. */
export function addConnection(projectDir: string, config: ConnectionConfig): void {
  updateLocalConfigBlock(projectDir, "connections", (block) => {
    if (Object.hasOwn(block, config.id)) throw new ConnectionWriteError(409, `A connection named ${config.id} already exists`);
    return { ...block, [config.id]: entryOf(config) };
  });
}

/** Remove connection `id`'s declaration. Throws a 404 when it is not declared. */
export function removeConnection(projectDir: string, id: string): void {
  updateLocalConfigBlock(projectDir, "connections", (block) => {
    if (!Object.hasOwn(block, id)) throw new ConnectionWriteError(404, `No connection named ${id}`);
    const { [id]: _removed, ...rest } = block;
    return rest;
  });
}

function editEntry(projectDir: string, id: string, edit: (entry: Json) => Json): void {
  updateLocalConfigBlock(projectDir, "connections", (block) => {
    const entry = block[id];
    if (!isRecord(entry)) throw new ConnectionWriteError(404, `No connection named ${id}`);
    return { ...block, [id]: edit({ ...entry }) };
  });
}

/** Name `profile` as connection `id`'s server profile, or with null stop naming one. */
export function setConnectionProfile(projectDir: string, id: string, profile: string | null): void {
  editEntry(projectDir, id, (entry) => {
    if (profile === null) delete entry.profile;
    else entry.profile = profile;
    return entry;
  });
}

/** A change to one tool's overrides: a value sets it, null clears it, absent leaves it. */
export interface ToolOverridePatch {
  class?: unknown;
  policy?: unknown;
}

/**
 * Apply `patch` to tool `tool` of connection `id`. Throws a 400 for a class or
 * policy outside the allowed values. An override left empty is removed.
 */
export function setToolOverride(projectDir: string, id: string, tool: string, patch: ToolOverridePatch): void {
  const fields = [
    ["class", patch.class, TOOL_CLASSES],
    ["policy", patch.policy, TOOL_POLICIES],
  ] as const;
  for (const [name, value, allowed] of fields) {
    if (value !== undefined && value !== null && !(allowed as readonly unknown[]).includes(value)) {
      throw new ConnectionWriteError(400, `"${name}" must be ${allowed.map((a) => `"${a}"`).join(", ")} or null`);
    }
  }
  editEntry(projectDir, id, (entry) => {
    const tools = isRecord(entry.tools) ? { ...entry.tools } : {};
    const override = isRecord(tools[tool]) ? { ...(tools[tool] as Json) } : {};
    for (const [name, value] of fields) {
      if (value === null) delete override[name];
      else if (value !== undefined) override[name] = value;
    }
    if (Object.keys(override).length > 0) tools[tool] = override;
    else delete tools[tool];
    if (Object.keys(tools).length > 0) entry.tools = tools;
    else delete entry.tools;
    return entry;
  });
}
