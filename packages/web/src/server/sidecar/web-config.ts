/**
 * The `web` section of a project's config, as the Sidecar reads and writes it.
 *
 * A value comes from the project's local config first, then its shared config.
 * A write lands in the file that currently supplies the key, so the saved value
 * is the one that takes effect, and in the shared config when neither does.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolveLayout } from "@n-dx/llm-client";

type Json = Record<string, unknown>;

function readJson(path: string): Json {
  if (!existsSync(path)) return {};
  const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Json) : {};
}

function asRecord(value: unknown): Json | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined;
}

/** A config file's path and its `web` section, local config first. */
function sources(projectDir: string): Array<{ file: string; web: Json }> {
  const { configFile, localConfigFile } = resolveLayout(projectDir);
  return [localConfigFile, configFile].map((file) => ({ file, web: asRecord(readJson(file).web) ?? {} }));
}

export function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** The first value `pick` accepts from the local then shared `web` section, else `undefined`. */
export function readWebValue<T>(projectDir: string, pick: (web: Json) => T | undefined): T | undefined {
  for (const { web } of sources(projectDir)) {
    const value = pick(web);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** One change to the `web` section: `path` under `web`, and its value (`undefined` removes the key). */
export interface WebChange {
  path: readonly string[];
  value: unknown;
}

function getAt(root: Json, path: readonly string[]): unknown {
  let node: unknown = root;
  for (const key of path) node = asRecord(node)?.[key];
  return node;
}

function setAt(root: Json, path: readonly string[], value: unknown): void {
  let node = root;
  for (const key of path.slice(0, -1)) {
    const next = asRecord(node[key]);
    if (next) {
      node = next;
    } else {
      const created: Json = {};
      node[key] = created;
      node = created;
    }
  }
  const last = path[path.length - 1];
  if (value === undefined) delete node[last];
  else node[last] = value;
}

/** Drop objects a removal left empty, so a reset does not leave `{}` behind. */
function prune(root: Json, path: readonly string[]): void {
  for (let depth = path.length - 1; depth > 0; depth -= 1) {
    const parentPath = path.slice(0, depth);
    const parent = asRecord(getAt(root, parentPath));
    if (!parent || Object.keys(parent).length > 0) return;
    setAt(root, parentPath, undefined);
  }
}

/** Apply `changes` to the config files that own their keys; returns the files written. */
export function writeWebValues(projectDir: string, changes: readonly WebChange[]): string[] {
  const { configFile } = resolveLayout(projectDir);
  const owners = sources(projectDir);
  const byFile = new Map<string, WebChange[]>();
  for (const change of changes) {
    const owner = owners.find(({ web }) => getAt(web, change.path) !== undefined)?.file ?? configFile;
    byFile.set(owner, [...(byFile.get(owner) ?? []), change]);
  }
  for (const [file, fileChanges] of byFile) {
    const config = readJson(file);
    const web = asRecord(config.web) ?? {};
    for (const change of fileChanges) {
      setAt(web, change.path, change.value);
      if (change.value === undefined) prune(web, change.path);
    }
    if (Object.keys(web).length > 0) config.web = web;
    else delete config.web;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(config, null, 2) + "\n", "utf-8");
  }
  return [...byFile.keys()];
}
