/**
 * The one write the Settings page makes to a project's untracked
 * `.n-dx.local.json`: a top-level key (`connections`, `trackerSync`) edited in
 * place, everything else in the file kept.
 *
 * Both blocks name a command to spawn or a place a stored credential is sent,
 * and the readers ignore them anywhere a repository could have chosen them. So
 * this refuses, rather than writes where they would be ignored: a local file the
 * repository commits, and a file that does not parse (the user's to fix;
 * overwriting it would discard whatever else they keep there). It never
 * touches the tracked `.n-dx.json`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isLocalConfigTracked, resolveLayout } from "@n-dx/llm-client";

type Json = Record<string, unknown>;

/** A write the file's state refuses; `message` is safe to show. */
export class LocalConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalConfigError";
  }
}

const isRecord = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);

/**
 * Edit the `key` block of the local config file: `update` receives a copy of
 * the block (`{}` when absent) and returns the block to store, or `undefined`
 * to remove the key. Returns the file's path.
 */
export function updateLocalConfigBlock(projectDir: string, key: string, update: (block: Json) => Json | undefined): string {
  const { localConfigFile } = resolveLayout(projectDir);
  if (isLocalConfigTracked(projectDir)) {
    throw new LocalConfigError(`${localConfigFile} is committed to the repository, so it is not your own config; untrack it before settings can be saved there`);
  }
  let local: Json = {};
  if (existsSync(localConfigFile)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(localConfigFile, "utf-8"));
    } catch (err) {
      throw new LocalConfigError(`${localConfigFile} is not valid JSON (${(err as Error).message}); fix it before settings can be saved there`);
    }
    if (!isRecord(parsed)) throw new LocalConfigError(`${localConfigFile} is not a JSON object`);
    local = parsed;
  }
  const current = isRecord(local[key]) ? { ...(local[key] as Json) } : {};
  const next = update(current);
  if (next === undefined || Object.keys(next).length === 0) delete local[key];
  else local[key] = next;
  mkdirSync(dirname(localConfigFile), { recursive: true });
  writeFileSync(localConfigFile, JSON.stringify(local, null, 2) + "\n", "utf-8");
  return localConfigFile;
}
