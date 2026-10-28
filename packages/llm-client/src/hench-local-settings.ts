/**
 * Hench settings a writer stores in the user's `.n-dx.local.json`.
 *
 * The trust review reads hench's `apiKeyEnv` from `.hench/config.json` and the
 * `.n-dx.json` `hench` section as the repository's credential routing
 * (`repo-trust.ts`), so a user's own choice written there would be ignored
 * until `ndx trust accept .` and would mark the checkout untrusted. Every
 * writer — `ndx config`, `hench config`, the dashboard — puts these keys in
 * the git-ignored local file instead, as `ndx config` already does for
 * `llm.*.apiKeyEnv` and the vendor CLI paths.
 *
 * @module llm-client/hench-local-settings
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolveLayout } from "./layout.js";
import { DEFAULT_HENCH_API_KEY_ENV } from "./repo-trust.js";

/**
 * Top-level hench keys stored in `.n-dx.local.json`, each with the value
 * `.hench/config.json` keeps so the checkout's own config names nothing new.
 */
export const HENCH_LOCAL_ONLY_SETTINGS: Readonly<Record<string, string>> = Object.freeze({
  apiKeyEnv: DEFAULT_HENCH_API_KEY_ENV,
});

/** Whether `key` (a top-level hench key) belongs in `.n-dx.local.json`. */
export function isHenchLocalOnlySetting(key: string): boolean {
  return Object.hasOwn(HENCH_LOCAL_ONLY_SETTINGS, key);
}

export interface HenchLocalSettingWrite {
  /** Absolute path of the local file written. */
  localFile: string;
  /** True when a copy in the shared `.n-dx.json` `hench` section was removed. */
  removedFromShared: boolean;
}

function readObject(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  // A file that does not parse is the user's to fix; overwriting it would
  // discard whatever else they keep there.
  const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function writeObject(path: string, data: Record<string, unknown>): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function sectionOf(data: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = data[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Set `hench.<key>` in the project's `.n-dx.local.json`, and remove the same
 * key from the shared `.n-dx.json` `hench` section, which would otherwise keep
 * the checkout untrusted. Leaves `.hench/config.json` to the caller, which
 * owns that write: it should hold {@link HENCH_LOCAL_ONLY_SETTINGS}`[key]`.
 * Throws when `key` is not local-only or a config file does not parse.
 */
export function writeHenchLocalSetting(projectDir: string, key: string, value: unknown): HenchLocalSettingWrite {
  if (!isHenchLocalOnlySetting(key)) {
    throw new Error(`hench.${key} is not stored in the local config`);
  }
  const layout = resolveLayout(projectDir);

  const local = readObject(layout.localConfigFile) ?? {};
  local.hench = { ...sectionOf(local, "hench"), [key]: value };
  writeObject(layout.localConfigFile, local);

  let removedFromShared = false;
  const shared = readObject(layout.configFile);
  const sharedHench = shared ? sectionOf(shared, "hench") : null;
  if (shared && sharedHench && Object.hasOwn(sharedHench, key)) {
    delete sharedHench[key];
    if (Object.keys(sharedHench).length === 0) delete shared.hench;
    writeObject(layout.configFile, shared);
    removedFromShared = true;
  }
  return { localFile: layout.localConfigFile, removedFromShared };
}
