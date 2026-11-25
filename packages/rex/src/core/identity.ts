/**
 * Actor identity resolution for attribution stamps.
 *
 * Resolves "who is making this change" for `lastModifiedBy` on PRD item
 * mutations and `actor` on execution log entries.
 *
 * Resolution order:
 *   1. `git config user.name` + `git config user.email` → `"Name <email>"`
 *   2. `git config user.name` only
 *   3. `git config user.email` only
 *   4. `os.userInfo().username`
 *   5. `"unknown"`
 *
 * The git identity is cached for the lifetime of the process — git config is
 * read at most once per run, regardless of how many mutations occur.
 *
 * What a PRD write stamps as `lastModifiedBy` is narrowed by the `attribution`
 * rex setting ({@link resolveStampActor}): `full` (the default) stamps the
 * identity above, `name` the git user name only, `none` nothing.
 *
 * @module rex/core/identity
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { userInfo } from "node:os";
import { execStdout, loadProjectOverrides } from "@n-dx/llm-client";

/** How much of the acting identity a PRD write stamps as `lastModifiedBy`. */
export type Attribution = "full" | "name" | "none";

/** Every {@link Attribution} mode, in documentation order. */
export const ATTRIBUTION_MODES: readonly Attribution[] = ["full", "name", "none"];

/** `full`: today's `"Name <email>"` stamp. */
export const DEFAULT_ATTRIBUTION: Attribution = "full";

interface GitIdentity {
  name?: string;
  email?: string;
}

let cachedIdentity: Promise<GitIdentity> | null = null;

/**
 * Read a single git config value. Returns `undefined` when unset, when git
 * is unavailable, or when not inside a git repository — `execStdout` never
 * rejects, so all of those cases surface as empty stdout.
 */
async function readGitConfig(key: string, cwd: string): Promise<string | undefined> {
  const raw = await execStdout("git", ["config", "--get", key], {
    cwd,
    timeout: 5000,
  });
  const value = raw.trim();
  return value.length > 0 ? value : undefined;
}

function resolveOsUser(): string {
  try {
    const username = userInfo().username;
    return username && username.length > 0 ? username : "unknown";
  } catch {
    // os.userInfo() can throw on some platforms/sandboxes when the current
    // user has no passwd entry.
    return "unknown";
  }
}

async function readIdentity(cwd: string): Promise<GitIdentity> {
  const [name, email] = await Promise.all([
    readGitConfig("user.name", cwd),
    readGitConfig("user.email", cwd),
  ]);
  return { name, email };
}

function gitIdentity(cwd: string): Promise<GitIdentity> {
  if (!cachedIdentity) {
    cachedIdentity = readIdentity(cwd);
  }
  return cachedIdentity;
}

/**
 * Resolve the current actor identity, caching the git lookup for the process.
 *
 * This is the full identity whatever the `attribution` setting says: it also
 * keys assignee matching (`ndx work --mine`). PRD stamps go through
 * {@link resolveStampActor}.
 *
 * @param cwd - Directory to read git config from (defaults to the process cwd).
 */
export async function resolveActor(cwd: string = "."): Promise<string> {
  const { name, email } = await gitIdentity(cwd);
  if (name && email) return `${name} <${email}>`;
  if (name) return name;
  if (email) return email;
  return resolveOsUser();
}

function isAttribution(value: unknown): value is Attribution {
  return typeof value === "string" && (ATTRIBUTION_MODES as readonly string[]).includes(value);
}

async function readConfigAttribution(rexDir: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(join(rexDir, "config.json"), "utf-8");
  } catch (err) {
    // No config.json yet (a fresh or test rex directory): the default applies.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  return (JSON.parse(raw) as Record<string, unknown>).attribution;
}

/**
 * The `attribution` setting for the rex directory `rexDir`: `config.json`,
 * then the `rex` section of `.n-dx.json`, then `.n-dx.local.json` (each later
 * one wins), else {@link DEFAULT_ATTRIBUTION}.
 *
 * Read on every call rather than cached, so a long-lived server picks up an
 * `ndx config rex.attribution` change on its next write.
 *
 * @throws when the setting holds anything but `full`, `name` or `none` — a
 *   privacy switch must not be ignored silently.
 */
export async function resolveAttribution(rexDir: string): Promise<Attribution> {
  const overrides = await loadProjectOverrides(rexDir, "rex");
  const value = "attribution" in overrides ? overrides.attribution : await readConfigAttribution(rexDir);
  if (value === undefined) return DEFAULT_ATTRIBUTION;
  if (!isAttribution(value)) {
    throw new Error(
      `Invalid rex attribution ${JSON.stringify(value)}: expected one of ${ATTRIBUTION_MODES.join(", ")}.`,
    );
  }
  return value;
}

/**
 * The `lastModifiedBy` a PRD write under `rexDir` stamps, or `null` when it
 * stamps none.
 *
 * - `full`: {@link resolveActor}.
 * - `name`: the git user name; `null` when git has none (an email alone is
 *   never written).
 * - `none`: `null`.
 *
 * `null` means "write no author": an existing `lastModifiedBy` is left as it
 * is, and a new item gets none.
 *
 * @param cwd - Directory to read git config from (defaults to the process cwd).
 */
export async function resolveStampActor(rexDir: string, cwd: string = "."): Promise<string | null> {
  const attribution = await resolveAttribution(rexDir);
  if (attribution === "none") return null;
  if (attribution === "name") return (await gitIdentity(cwd)).name ?? null;
  return resolveActor(cwd);
}

/**
 * Clear the cached identity so the next `resolveActor()` call re-resolves.
 * Test-only — production code resolves once per process by design.
 */
export function _resetActorCacheForTests(): void {
  cachedIdentity = null;
}
