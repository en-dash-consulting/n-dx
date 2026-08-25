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
 * The result is cached for the lifetime of the process — git config is
 * read at most once per run, regardless of how many mutations occur.
 *
 * @module rex/core/identity
 */

import { userInfo } from "node:os";
import { execStdout } from "@n-dx/llm-client";

let cachedActor: Promise<string> | null = null;

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

async function resolve(cwd: string): Promise<string> {
  const [name, email] = await Promise.all([
    readGitConfig("user.name", cwd),
    readGitConfig("user.email", cwd),
  ]);
  if (name && email) return `${name} <${email}>`;
  if (name) return name;
  if (email) return email;
  return resolveOsUser();
}

/**
 * Resolve the current actor identity, caching the result for the process.
 *
 * @param cwd - Directory to read git config from (defaults to the process cwd).
 */
export function resolveActor(cwd: string = "."): Promise<string> {
  if (!cachedActor) {
    cachedActor = resolve(cwd);
  }
  return cachedActor;
}

/**
 * Clear the cached actor so the next `resolveActor()` call re-resolves.
 * Test-only — production code resolves once per process by design.
 */
export function _resetActorCacheForTests(): void {
  cachedActor = null;
}
