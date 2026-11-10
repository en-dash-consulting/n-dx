/**
 * Frame keys: the short-lived credential a Sidecar drawer tab is served with
 * (docs/extensions/hub-api.md, "Frame keys").
 *
 * An extension's tab is an iframe sandboxed without `allow-same-origin`, so it
 * sends neither the per-user token nor the cookie a dashboard request carries.
 * The hub hands the drawer a URL with a key in its base path instead —
 * `/x/<name>/~f/<key>/…` — and the proxy accepts that key in place of the
 * token, on that extension's paths and nowhere else.
 *
 * A key is 32 random bytes, base64url, held only in this process's memory, so
 * a hub restart drops every one. It is bound to one extension, and the
 * project it was issued for is recorded with it. It goes stale after the
 * extension's `idleStopMinutes` without use (each accepted request slides the
 * window) and, whatever its use, {@link FRAME_KEY_HARD_CAP_MS} after issue.
 * {@link FrameKeys.revoke} drops an extension's keys on disable, removal or
 * revoked approval.
 *
 * @module web/hub/frame-keys
 */

import { randomBytes } from "node:crypto";

/** The path segment that introduces a key: `/x/<name>/~f/<key>/`. */
export const FRAME_KEY_SEGMENT = "~f";
/** The longest a key lives, however busy its tab. */
export const FRAME_KEY_HARD_CAP_MS = 8 * 60 * 60_000;
/**
 * Core's default `idleStopMinutes` (`DEFAULT_SIDECAR_IDLE_STOP_MINUTES` in
 * packages/core/extension-dispatch.js), for a manifest that sets none. A twin
 * because the hub cannot import core; tests/e2e/extension-api-version-parity.test.js pins the two.
 */
export const DEFAULT_IDLE_STOP_MINUTES = 15;

/** `/x/<name>/~f/<key>` and what follows: the key's alphabet is base64url. */
const KEYED_PATH = /^\/x\/([^/]*)\/~f\/([A-Za-z0-9_-]+)(\/.*)?$/;

export interface FrameKeyOptions {
  now?: () => number;
  hardCapMs?: number;
}

export interface IssuedFrameKey {
  key: string;
  /** When the key goes stale unless used before then, epoch ms. */
  expiresAt: number;
}

interface FrameKeyRecord {
  name: string;
  projectId: string;
  idleMs: number;
  issuedAt: number;
  lastUsed: number;
}

/** A keyed sidecar path, split; null for any other path. `rest` is undefined for the bare `/x/<name>/~f/<key>`. */
export function parseKeyedPath(pathname: string): { name: string; key: string; rest: string | undefined } | null {
  const match = KEYED_PATH.exec(pathname);
  return match ? { name: match[1], key: match[2], rest: match[3] } : null;
}

/** The keys this hub has issued. */
export class FrameKeys {
  private readonly keys = new Map<string, FrameKeyRecord>();
  private readonly now: () => number;
  private readonly hardCapMs: number;

  constructor(options: FrameKeyOptions = {}) {
    this.now = options.now ?? Date.now;
    this.hardCapMs = options.hardCapMs ?? FRAME_KEY_HARD_CAP_MS;
  }

  /** A new key for `name`'s tab in `projectId`, going stale after `idleMs` unused. */
  issue(name: string, projectId: string, idleMs: number): IssuedFrameKey {
    this.prune();
    const key = randomBytes(32).toString("base64url");
    const now = this.now();
    const record: FrameKeyRecord = { name, projectId, idleMs, issuedAt: now, lastUsed: now };
    this.keys.set(key, record);
    return { key, expiresAt: this.expiry(record) };
  }

  /** Whether `key` is live and bound to `name`; a yes counts as use and slides its window. */
  accept(name: string, key: string): boolean {
    const record = this.live(key);
    if (!record || record.name !== name) return false;
    record.lastUsed = this.now();
    return true;
  }

  /** Whether `key` is live and bound to `name`, without counting a use. */
  isLive(name: string, key: string): boolean {
    return this.live(key)?.name === name;
  }

  /** Drop every key bound to `name`. Returns how many there were. */
  revoke(name: string): number {
    let dropped = 0;
    for (const [key, record] of this.keys) {
      if (record.name !== name) continue;
      this.keys.delete(key);
      dropped++;
    }
    return dropped;
  }

  private live(key: string): FrameKeyRecord | null {
    const record = this.keys.get(key);
    if (!record) return null;
    if (this.now() >= this.expiry(record)) {
      this.keys.delete(key);
      return null;
    }
    return record;
  }

  private expiry(record: FrameKeyRecord): number {
    return Math.min(record.lastUsed + record.idleMs, record.issuedAt + this.hardCapMs);
  }

  private prune(): void {
    const now = this.now();
    for (const [key, record] of this.keys) {
      if (now >= this.expiry(record)) this.keys.delete(key);
    }
  }
}
