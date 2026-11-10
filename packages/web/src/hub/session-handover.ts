/**
 * Handing the hub's signed-in browser sessions to the hub that replaces it.
 *
 * Browser sessions live in the hub's memory (`shared/auth.ts`), so any
 * restart signs every open dashboard tab out. That is the point for
 * `ndx hub stop`. When `ndx start` replaces an older hub itself, though, it
 * would make every tab need a fresh `ndx start` link — the manual step the
 * replacement exists to remove. So, and only then:
 *
 * 1. Just before stopping it, `ndx start` asks the old hub (token only:
 *    `POST /api/hub/handover`) to write its live sessions to a one-shot file
 *    in the ndx home ({@link writeSessionHandover}).
 * 2. The new hub, on the same home and port, takes the file at startup
 *    ({@link takeSessionHandover}): it deletes it first, then accepts it only
 *    when it is recent, written for this home, this port and this per-user
 *    token, and (where the platform reports it) owned by this user and not
 *    readable by anyone else.
 *
 * What travels is each session's SHA-256 digest and expiries — never the
 * credential, a landing nonce, a WebSocket ticket or the per-user token. The
 * token is represented only by a digest of it, to tell a file written under
 * another token apart. A browser still presents its own credential in a
 * header, compared in constant time against the digest; sessionStorage keeps
 * it per origin, and the port check keeps the hand-over to that one origin.
 *
 * @module web/hub/session-handover
 */

import { createHash } from "node:crypto";
import { readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { writeOwnerOnlyFile } from "@n-dx/llm-client";
import type { HandedOverSession } from "../shared/index.js";

/** File name of the hand-over, in the ndx home. `ndx hub stop` removes it (core's web.js names it too). */
export const SESSION_HANDOVER_FILE = "hub-sessions.handover.json";

/**
 * How old a hand-over may be when the new hub reads it. The replacement stops
 * the old hub (a grace of ten seconds), waits for the port, and starts the
 * new one; two minutes covers a slow machine without leaving a file that a
 * much later start could pick up.
 */
export const SESSION_HANDOVER_MAX_AGE_MS = 2 * 60_000;

const SCHEMA = "ndx/hub-session-handover/v1";

/** Hex SHA-256: how sessions are matched after a hand-over. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Which token a hand-over was written under, without the token. */
function tokenId(token: string): string {
  return sha256Hex(`ndx-hub-session-handover\0${token}`);
}

/** One spelling of the home directory: symlinks resolved, case folded where the filesystem folds it. */
function canonicalHome(dir: string): string {
  let real = resolve(dir);
  try {
    real = realpathSync.native(real);
  } catch {
    // Gone: compared as given.
  }
  return process.platform === "win32" || process.platform === "darwin" ? real.toLowerCase() : real;
}

export interface HandoverTarget {
  /** The ndx home the hub runs in. */
  home: string;
  /** The port the hub listens on — the browser's origin. */
  port: number;
  /** The per-user token the hub requires. */
  token: string;
  now?: () => number;
}

/** Write the sessions for the hub that takes this one's place. Returns how many were written. */
export function writeSessionHandover(target: HandoverTarget, sessions: readonly HandedOverSession[]): number {
  const now = target.now ?? Date.now;
  const body = {
    schema: SCHEMA,
    home: canonicalHome(target.home),
    port: target.port,
    tokenId: tokenId(target.token),
    writtenAt: now(),
    sessions,
  };
  writeOwnerOnlyFile(join(target.home, SESSION_HANDOVER_FILE), `${JSON.stringify(body)}\n`);
  return sessions.length;
}

export type HandoverTake =
  | { taken: true; sessions: unknown[] }
  | { taken: false; reason: string | null };

/**
 * Take the hand-over in `target.home`, if there is one. The file is deleted
 * before anything in it is believed, whatever it holds, so it is used at most
 * once. `reason` says why one that was there was refused; null when there was
 * none.
 */
export function takeSessionHandover(target: HandoverTarget): HandoverTake {
  const now = (target.now ?? Date.now)();
  const path = join(target.home, SESSION_HANDOVER_FILE);
  let text: string;
  let owner: { uid: number; mode: number } | null = null;
  try {
    const stat = statSync(path);
    owner = { uid: stat.uid, mode: stat.mode };
    text = readFileSync(path, "utf-8");
  } catch {
    return { taken: false, reason: null };
  } finally {
    rmSync(path, { force: true });
  }
  // POSIX reports an owner and modes; Windows reports neither meaningfully,
  // and there the per-user profile directory is the boundary, as for the token.
  if (process.platform !== "win32" && owner) {
    const uid = process.getuid?.();
    if (uid !== undefined && owner.uid !== uid) return { taken: false, reason: "it is owned by another user" };
    if ((owner.mode & 0o077) !== 0) return { taken: false, reason: "it is readable by other users" };
  }
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return { taken: false, reason: "it is not a hand-over" };
    body = parsed as Record<string, unknown>;
  } catch {
    return { taken: false, reason: "it is not valid JSON" };
  }
  if (body.schema !== SCHEMA) return { taken: false, reason: "it is not a hand-over this hub reads" };
  if (typeof body.writtenAt !== "number" || now - body.writtenAt > SESSION_HANDOVER_MAX_AGE_MS || body.writtenAt - now > 5_000) {
    return { taken: false, reason: "it is too old" };
  }
  if (body.home !== canonicalHome(target.home)) return { taken: false, reason: "it was written for another ndx home" };
  if (body.port !== target.port) return { taken: false, reason: "it was written for another port" };
  if (body.tokenId !== tokenId(target.token)) return { taken: false, reason: "it was written under another token" };
  if (!Array.isArray(body.sessions)) return { taken: false, reason: "it holds no sessions" };
  return { taken: true, sessions: body.sessions };
}
