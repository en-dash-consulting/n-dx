/**
 * Server profiles: data, per MCP server, that improves a connection without
 * any code knowing that server.
 *
 * A profile carries `fieldHints` per write tool (the same hint shape as a
 * connection's own, which win for the same property) and, for a tracker, an
 * optional `tracker` mapping: which tools create, move, read and edit an item,
 * the ndx event → tracker status map, the facts each event needs and where
 * they come from, and defaults (reviewer, estimate scale). An optional `oauth`
 * block names the scopes an OAuth sign-in asks for (oauth-scopes.ts).
 *
 * Built-in profiles ship as JSON beside this file (CAOS first). A user adds
 * their own as `<ndx home>/tracker-profiles/<name>.json`. A connection names
 * one by `profile`: a bare name is the built-in of that name, else the user's;
 * `user:<name>` is the user's only, so a user file never replaces a built-in
 * by accident.
 *
 * A profile is checked against the connected server's tool list before it is
 * used: every tool it names must be listed, and the status map must cover
 * every ndx event. A profile that fails is not used, and the reason names the
 * gap; the connection still works attended, without its hints.
 *
 * See docs/architecture/sidecar-connections.md.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveNdxHome } from "@n-dx/llm-client";
import { parseFieldHints, type FieldHints } from "../connections/connection-config.js";
import caos from "./profiles/caos.json" with { type: "json" };

/** The ndx events tracker sync rules fire on, in workflow order. */
export const TRACKER_EVENTS = [
  "change-captured",
  "run-started",
  "pr-opened",
  "pr-merged",
  "release-published",
  "run-failed-twice",
] as const;

export type TrackerEvent = (typeof TRACKER_EVENTS)[number];

/** Where a fact's value comes from; the first source that answers wins. */
export const FACT_SOURCES = [
  "item",
  "feature-map",
  "loe",
  "profile-default",
  "codeowners",
  "pr-url",
  "release",
  "run-diagnosis",
  "constant",
] as const;

export type FactSource = (typeof FACT_SOURCES)[number];

/** One value a tracker call needs: the input property it fills (dotted for nested) and its sources. */
export interface TrackerFact {
  fact: string;
  property: string;
  from: FactSource[];
  /** The value of a `constant` source. */
  value?: string;
}

/** What a tracker cannot do for ndx, so a person must: each surfaces as a card naming the work. */
export const TRACKER_LIMITS = ["create-feature"] as const;
export type TrackerLimit = (typeof TRACKER_LIMITS)[number];

export interface TrackerMapping {
  createTool: string;
  moveTool: string;
  readTool: string;
  editTool?: string;
  /** The idempotency property every call fills automatically with ndx:<project>:<rexId>:<event>. */
  requestIdProperty: string;
  /** The move, read and edit tools' item id property. */
  itemIdProperty: string;
  /** The create tool's initial status property, when it has one. */
  createStatusProperty?: string;
  moveStatusProperty: string;
  statusMap: Record<TrackerEvent, string>;
  facts: Partial<Record<TrackerEvent, TrackerFact[]>>;
  defaults: { reviewer?: string; estimateScale?: string[] };
  /** Declared limits of the tracker; none when it can do everything ndx asks. */
  limits: TrackerLimit[];
  /**
   * An http(s) URL for a work item, built from its id: `{id}` is the id as
   * given, `{compactId}` the id without dashes. Lets an opaque id, which is no
   * work ref, become a link (see trackerItemUrl).
   */
  itemUrlTemplate?: string;
}

const ITEM_URL_PLACEHOLDERS = ["{id}", "{compactId}"] as const;

/** The one placeholder `template` holds, or why it is no item URL template. */
function templatePlaceholder(template: string): (typeof ITEM_URL_PLACEHOLDERS)[number] | { problem: string } {
  const held = ITEM_URL_PLACEHOLDERS.filter((p) => template.split(p).length === 2);
  const repeated = ITEM_URL_PLACEHOLDERS.some((p) => template.split(p).length > 2);
  if (held.length !== 1 || repeated) return { problem: "tracker.itemUrlTemplate must hold exactly one {id} or {compactId}" };
  if (!/^https?:\/\/[^\s/?#{}]+/.test(template) || !URL.canParse(template.replace(held[0], "x"))) {
    return { problem: "tracker.itemUrlTemplate must be an http(s) URL" };
  }
  return held[0];
}

/** The URL `mapping` builds for work item `id`, or undefined when it has no template. */
export function trackerItemUrl(mapping: Pick<TrackerMapping, "itemUrlTemplate">, id: string): string | undefined {
  const template = mapping.itemUrlTemplate;
  if (!template) return undefined;
  const placeholder = templatePlaceholder(template);
  if (typeof placeholder !== "string") return undefined;
  const value = placeholder === "{compactId}" ? id.replaceAll("-", "") : id;
  return template.replace(placeholder, encodeURIComponent(value));
}

const COMPACT_UUID = /^([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/i;

/**
 * The work item id a linked `ref` names for the tracker's tools: the id inside
 * a URL the profile's template built, else `ref` itself (a key, or a URL the
 * tracker takes as given). A `{compactId}` that is a dashless UUID gets its
 * dashes back; any other compact id is passed on as it reads.
 */
export function trackerItemIdOfRef(mapping: Pick<TrackerMapping, "itemUrlTemplate">, ref: string): string {
  const template = mapping.itemUrlTemplate;
  if (!template) return ref;
  const placeholder = templatePlaceholder(template);
  if (typeof placeholder !== "string") return ref;
  const [prefix, suffix] = template.split(placeholder);
  if (!ref.startsWith(prefix) || !ref.endsWith(suffix) || ref.length <= prefix.length + suffix.length) return ref;
  const id = decodeURIComponent(ref.slice(prefix.length, ref.length - suffix.length));
  if (placeholder === "{id}") return id;
  const uuid = COMPACT_UUID.exec(id);
  return uuid ? uuid.slice(1).join("-") : id;
}

/**
 * The OAuth scopes a sign-in asks for (oauth-scopes.ts): `readScopes` always,
 * `writeScopes` too while any of `writeTools` may run.
 */
export interface ProfileOAuth {
  readScopes: string[];
  writeScopes: string[];
  writeTools: string[];
}

export interface ServerProfile {
  /** As a connection names it: `caos`, or `user:<name>` for a user's own. */
  name: string;
  label: string;
  /** Hints by write tool, then property. */
  fieldHints: Record<string, FieldHints>;
  tracker?: TrackerMapping;
  oauth?: ProfileOAuth;
}

/** A profile ready to use, or why it is not. */
export type ProfileResolution =
  | { name: string; state: "ok"; profile: ServerProfile }
  | { name: string; state: "invalid"; problem: string };

/** The part of a listed tool a check reads. */
export interface ProfileTool {
  tool: string;
  inputSchema: unknown;
}

export interface ProfileOptions {
  /** The per-user directory holding tracker-profiles/; defaults to resolveNdxHome's answer. */
  ndxHome?: string;
}

/** The directory under the ndx home that holds a user's profiles. */
export const USER_PROFILES_DIR = "tracker-profiles";

const BUILT_IN: Record<string, unknown> = { caos };

/** A profile's own name: a file name, so nothing else may reach outside the directory. */
const PROFILE_NAME = /^[a-z][a-z0-9-]{0,40}$/;
const USER_PREFIX = "user:";

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string" && value !== "";

/** The built-in profile names. */
export function builtInProfileNames(): string[] {
  return Object.keys(BUILT_IN);
}

/** `raw` as a mapping, or the problems with it. */
function parseMapping(raw: unknown, problems: string[]): TrackerMapping | undefined {
  if (!isRecord(raw)) {
    problems.push("tracker must be an object");
    return undefined;
  }
  const required = ["createTool", "moveTool", "readTool", "requestIdProperty", "itemIdProperty", "moveStatusProperty"] as const;
  for (const key of required) if (!isString(raw[key])) problems.push(`tracker.${key} must be a non-empty string`);
  for (const key of ["editTool", "createStatusProperty"] as const) {
    if (raw[key] !== undefined && !isString(raw[key])) problems.push(`tracker.${key} must be a non-empty string when set`);
  }

  const statusMap = isRecord(raw.statusMap) ? raw.statusMap : undefined;
  if (!statusMap) problems.push("tracker.statusMap must map each ndx event to a status");
  else {
    for (const event of TRACKER_EVENTS) if (!isString(statusMap[event])) problems.push(`tracker.statusMap has no status for ${event}`);
    for (const key of Object.keys(statusMap)) {
      if (!(TRACKER_EVENTS as readonly string[]).includes(key)) problems.push(`tracker.statusMap names ${key}, which is not an ndx event`);
    }
  }

  const facts: Partial<Record<TrackerEvent, TrackerFact[]>> = {};
  if (raw.facts !== undefined && !isRecord(raw.facts)) problems.push("tracker.facts must be an object keyed by ndx event");
  for (const [event, list] of Object.entries(isRecord(raw.facts) ? raw.facts : {})) {
    if (!(TRACKER_EVENTS as readonly string[]).includes(event)) {
      problems.push(`tracker.facts names ${event}, which is not an ndx event`);
      continue;
    }
    if (!Array.isArray(list)) {
      problems.push(`tracker.facts.${event} must be a list`);
      continue;
    }
    facts[event as TrackerEvent] = list.flatMap((entry, index): TrackerFact[] => {
      const at = `tracker.facts.${event}[${index}]`;
      if (!isRecord(entry) || !isString(entry.fact) || !isString(entry.property) || !Array.isArray(entry.from) || entry.from.length === 0) {
        problems.push(`${at} must have a fact, a property and a non-empty from list`);
        return [];
      }
      const unknown = entry.from.filter((source) => !(FACT_SOURCES as readonly unknown[]).includes(source));
      if (unknown.length > 0) problems.push(`${at} has unknown sources ${unknown.map(String).join(", ")}`);
      if (entry.from.includes("constant") && !isString(entry.value)) problems.push(`${at} takes a constant, so it needs a value`);
      return [{ fact: entry.fact, property: entry.property, from: entry.from as FactSource[], ...(isString(entry.value) && { value: entry.value }) }];
    });
  }

  const defaults = raw.defaults === undefined ? {} : raw.defaults;
  if (!isRecord(defaults)) problems.push("tracker.defaults must be an object");
  else {
    if (defaults.reviewer !== undefined && !isString(defaults.reviewer)) problems.push("tracker.defaults.reviewer must be a string");
    if (defaults.estimateScale !== undefined && !(Array.isArray(defaults.estimateScale) && defaults.estimateScale.every(isString))) {
      problems.push("tracker.defaults.estimateScale must be a list of strings");
    }
  }
  const limits = raw.limits === undefined ? [] : raw.limits;
  if (!Array.isArray(limits) || limits.some((limit) => !(TRACKER_LIMITS as readonly unknown[]).includes(limit))) {
    problems.push(`tracker.limits must be a list drawn from ${TRACKER_LIMITS.join(", ")}`);
  }
  if (raw.itemUrlTemplate !== undefined) {
    const placeholder = isString(raw.itemUrlTemplate) ? templatePlaceholder(raw.itemUrlTemplate) : { problem: "tracker.itemUrlTemplate must be a non-empty string when set" };
    if (typeof placeholder !== "string") problems.push(placeholder.problem);
  }
  if (problems.length > 0) return undefined;
  return {
    createTool: raw.createTool as string,
    moveTool: raw.moveTool as string,
    readTool: raw.readTool as string,
    ...(isString(raw.editTool) && { editTool: raw.editTool }),
    requestIdProperty: raw.requestIdProperty as string,
    itemIdProperty: raw.itemIdProperty as string,
    ...(isString(raw.createStatusProperty) && { createStatusProperty: raw.createStatusProperty }),
    moveStatusProperty: raw.moveStatusProperty as string,
    statusMap: statusMap as Record<TrackerEvent, string>,
    facts,
    defaults: defaults as TrackerMapping["defaults"],
    limits: limits as TrackerLimit[],
    ...(isString(raw.itemUrlTemplate) && { itemUrlTemplate: raw.itemUrlTemplate }),
  };
}

/** An OAuth scope: a non-empty token with no spaces (RFC 6749 §3.3). */
const SCOPE = /^[\x21\x23-\x5B\x5D-\x7E]+$/;

/** `raw` as the profile's OAuth scopes, or the problems with it. */
function parseOAuth(raw: unknown, problems: string[]): ProfileOAuth | undefined {
  if (!isRecord(raw)) {
    problems.push("oauth must be an object");
    return undefined;
  }
  const list = (key: "readScopes" | "writeScopes" | "writeTools", pattern: RegExp): string[] => {
    const value = raw[key] ?? [];
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && pattern.test(entry))) {
      problems.push(`oauth.${key} must be a list of ${key === "writeTools" ? "tool names" : "scopes"}`);
      return [];
    }
    return value as string[];
  };
  const oauth = { readScopes: list("readScopes", SCOPE), writeScopes: list("writeScopes", SCOPE), writeTools: list("writeTools", /^\S+$/) };
  if (oauth.writeScopes.length > 0 && oauth.writeTools.length === 0) problems.push("oauth.writeScopes needs the writeTools that use them");
  return oauth;
}

/** `raw` as a profile named `name`, or every problem with its shape. */
export function parseServerProfile(name: string, raw: unknown): ServerProfile | { problems: string[] } {
  if (!isRecord(raw)) return { problems: ["a profile must be a JSON object"] };
  const problems: string[] = [];
  const fieldHints: Record<string, FieldHints> = {};
  if (raw.fieldHints !== undefined && !isRecord(raw.fieldHints)) problems.push("fieldHints must be an object keyed by tool");
  for (const [tool, block] of Object.entries(isRecord(raw.fieldHints) ? raw.fieldHints : {})) {
    const skipped: string[] = [];
    const hints = parseFieldHints(block, skipped);
    problems.push(...skipped.map((reason) => `fieldHints.${tool}: ${reason}`));
    if (hints) fieldHints[tool] = hints;
  }
  const tracker = raw.tracker === undefined ? undefined : parseMapping(raw.tracker, problems);
  const oauth = raw.oauth === undefined ? undefined : parseOAuth(raw.oauth, problems);
  if (problems.length > 0) return { problems };
  return { name, label: isString(raw.label) ? raw.label : name, fieldHints, ...(tracker && { tracker }), ...(oauth && { oauth }) };
}

function readUserProfile(file: string, name: string): unknown | { problems: string[] } {
  if (!existsSync(file)) return { problems: [`no profile named ${name} (looked in the built-ins and ${file})`] };
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as unknown;
  } catch (err) {
    return { problems: [`${file} is not valid JSON: ${(err as Error).message}`] };
  }
}

const isProblems = (value: unknown): value is { problems: string[] } => isRecord(value) && Array.isArray(value.problems);

/**
 * The profile `name` names, read but not yet checked against a server:
 * `user:<n>` from the user's directory only; a bare name from the built-ins
 * first, then the user's directory.
 */
export function loadServerProfile(name: string, options: ProfileOptions = {}): ServerProfile | { problems: string[] } {
  const userOnly = name.startsWith(USER_PREFIX);
  const base = userOnly ? name.slice(USER_PREFIX.length) : name;
  if (!PROFILE_NAME.test(base)) return { problems: [`a profile name must match ${PROFILE_NAME} (or user:<name>)`] };
  if (!userOnly && Object.hasOwn(BUILT_IN, base)) return parseServerProfile(name, BUILT_IN[base]);
  const file = join(options.ndxHome ?? resolveNdxHome(), USER_PROFILES_DIR, `${base}.json`);
  const raw = readUserProfile(file, name);
  return isProblems(raw) ? raw : parseServerProfile(name, raw);
}

/** The schema of `property` (dotted for nested) in `schema`; null when the schema lists no properties to check. */
function propertySchema(schema: unknown, property: string): Json | undefined | null {
  let current: unknown = schema;
  for (const key of property.split(".")) {
    if (!isRecord(current) || !isRecord(current.properties)) return null;
    current = current.properties[key];
    if (current === undefined) return undefined;
  }
  return isRecord(current) ? current : {};
}

/**
 * Every way `profile` does not fit a server listing `tools`: a tool it names
 * that is not listed, a property a tool's schema does not declare, a status
 * outside the status property's enum. Empty when it fits.
 */
export function checkServerProfile(profile: ServerProfile, tools: readonly ProfileTool[]): string[] {
  const byName = new Map(tools.map((tool) => [tool.tool, tool]));
  const problems: string[] = [];
  const listed = (tool: string, where: string): ProfileTool | undefined => {
    const found = byName.get(tool);
    if (!found) problems.push(`${where} names ${tool}, which the server does not list`);
    return found;
  };
  const declares = (tool: ProfileTool | undefined, property: string, where: string): Json | undefined => {
    if (!tool) return undefined;
    const schema = propertySchema(tool.inputSchema, property);
    if (schema === undefined) problems.push(`${where} names ${property}, which ${tool.tool}'s input does not declare`);
    return schema ?? undefined;
  };

  for (const [toolName, hints] of Object.entries(profile.fieldHints)) {
    const tool = listed(toolName, `fieldHints.${toolName}`);
    for (const [property, hint] of Object.entries(hints)) {
      declares(tool, property, `fieldHints.${toolName}`);
      if ("optionsFrom" in hint) {
        const where = `fieldHints.${toolName}.${property}`;
        const read = listed(hint.optionsFrom.tool, where);
        for (const name of Object.keys(hint.optionsFrom.arguments ?? {})) declares(read, name, `${where}.arguments`);
      }
    }
  }

  for (const tool of profile.oauth?.writeTools ?? []) listed(tool, "oauth.writeTools");

  const mapping = profile.tracker;
  if (!mapping) return problems;
  const create = listed(mapping.createTool, "tracker.createTool");
  const move = listed(mapping.moveTool, "tracker.moveTool");
  const read = listed(mapping.readTool, "tracker.readTool");
  const edit = mapping.editTool ? listed(mapping.editTool, "tracker.editTool") : undefined;
  for (const tool of [create, move, edit]) declares(tool, mapping.requestIdProperty, "tracker.requestIdProperty");
  for (const tool of [move, read, edit]) declares(tool, mapping.itemIdProperty, "tracker.itemIdProperty");

  const statusSchema = (tool: ProfileTool | undefined, property: string | undefined, where: string) =>
    property ? declares(tool, property, where) : undefined;
  const createStatus = statusSchema(create, mapping.createStatusProperty, "tracker.createStatusProperty");
  const moveStatus = statusSchema(move, mapping.moveStatusProperty, "tracker.moveStatusProperty");
  for (const event of TRACKER_EVENTS) {
    const status = mapping.statusMap[event];
    const allowed = (event === "change-captured" ? createStatus : moveStatus)?.enum;
    if (Array.isArray(allowed) && !allowed.includes(status)) {
      problems.push(`tracker.statusMap.${event} is ${status}, which is not a status the server accepts`);
    }
  }
  for (const [event, facts] of Object.entries(mapping.facts) as Array<[TrackerEvent, TrackerFact[]]>) {
    const tool = event === "change-captured" ? create : move;
    for (const fact of facts) declares(tool, fact.property, `tracker.facts.${event} (${fact.fact})`);
  }
  return problems;
}

/** The profile `name` checked against a server's `tools`: ready to use, or why it is not. */
export function resolveServerProfile(name: string, tools: readonly ProfileTool[], options: ProfileOptions = {}): ProfileResolution {
  const loaded = loadServerProfile(name, options);
  const problems = isProblems(loaded) ? loaded.problems : checkServerProfile(loaded, tools);
  if (problems.length > 0) return { name, state: "invalid", problem: `profile ${name} is not used: ${problems.join("; ")}` };
  return { name, state: "ok", profile: loaded as ServerProfile };
}

/** The field hints profile `name` adds to `tool`'s card; none when the profile does not fit the server. */
export function profileFieldHints(name: string, tool: string, tools: readonly ProfileTool[], options: ProfileOptions = {}): FieldHints {
  const resolution = resolveServerProfile(name, tools, options);
  return resolution.state === "ok" ? resolution.profile.fieldHints[tool] ?? {} : {};
}
