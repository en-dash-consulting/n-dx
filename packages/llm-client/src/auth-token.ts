/**
 * The per-user dashboard token.
 *
 * The hub and the project servers listen on loopback with no credential, and
 * loopback is shared by every account on a host. The token is what tells
 * the user's own browser and CLI apart from another account's process: it
 * lives in `<ndx home>/auth.token` with owner-only modes, `ndx start` hands
 * it to the hub, the hub hands it to the project servers it spawns, and the
 * URL `ndx start` prints carries it once so the browser can set its cookie.
 *
 * This module only manages the file. Checking a request against the token
 * is the web package's job (`shared/auth.ts`), and nothing here is secret
 * handling beyond "random bytes, 0600": the token is a session credential
 * for a local server, not a key to anything else.
 */

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveNdxHome, type ResolveNdxHomeOptions } from "./layout.js";

export const AUTH_TOKEN_FILENAME = "auth.token";

export interface AuthTokenPathOptions extends ResolveNdxHomeOptions {
  /** Override the per-user directory entirely (tests). */
  ndxHome?: string;
}

/** Where this user's token lives, whether or not it exists yet. */
export function resolveAuthTokenPath(options: AuthTokenPathOptions = {}): string {
  return join(options.ndxHome ?? resolveNdxHome(options), AUTH_TOKEN_FILENAME);
}

/** The token in `path`, trimmed; `null` when the file is missing or empty. */
export function readAuthToken(path: string): string | null {
  try {
    const value = readFileSync(path, "utf-8").trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Tighten a token file that is readable by anyone but its owner.
 *
 * Creating it 0600 only covers the file this process created. A token left at
 * 0644 by an older n-dx, an editor, or a restored backup is the exact exposure
 * the token exists to prevent, and it would otherwise survive every later run,
 * because the create path is the only one that ever set a mode.
 */
function repairTokenMode(path: string): void {
  try {
    // Group/other bits only; the owner's are none of our business.
    if ((statSync(path).mode & 0o077) !== 0) chmodSync(path, 0o600);
  } catch {
    // Not every filesystem reports or honours modes (Windows, some network
    // shares). The token is still usable; the profile directory is the boundary.
  }
}

/**
 * Read the token, creating it when absent. The directory is 0700 and the
 * file 0600; on Windows the modes are advisory and the profile directory is
 * the boundary. An existing token is never rotated here — every server that
 * is already running was started with it — but its mode is repaired.
 */
export function ensureAuthToken(path: string): string {
  const existing = readAuthToken(path);
  if (existing) {
    repairTokenMode(path);
    return existing;
  }
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString("base64url");
  writeFileSync(path, `${token}\n`, { encoding: "utf-8", mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Not every filesystem honours modes; the file still exists.
  }
  return token;
}

/** Whether a token file exists at `path` (without reading it). */
export function hasAuthToken(path: string): boolean {
  return existsSync(path);
}
