/**
 * A hub that `ndx start` replaces hands its signed-in browser sessions to the
 * hub that takes its place, and nothing else does.
 *
 * - After `POST /api/hub/handover` and a restart on the same home and port, a
 *   session minted by the old hub is still accepted by the new one.
 * - The hand-over file is owner-only, holds no session credential, nonce,
 *   ticket or per-user token, and is gone once the new hub has started.
 * - It is ignored when stale, or written for another home, port or token.
 * - A plain stop (no hand-over) still signs every tab out.
 * - Only the per-user token can ask for a hand-over.
 *
 * Real hubs in a temporary ndx home on an OS-assigned port, one after another.
 *
 * @see packages/web/src/hub/session-handover.ts
 * @see packages/web/src/shared/auth.ts — CredentialStore.exportSessions / importSessions
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { request as httpRequest } from "node:http";
import { startHub } from "../../src/hub/index.js";
import type { HubHandle } from "../../src/hub/index.js";
import { SESSION_HANDOVER_FILE, SESSION_HANDOVER_MAX_AGE_MS, takeSessionHandover, writeSessionHandover } from "../../src/hub/session-handover.js";
import { CredentialStore } from "../../src/shared/index.js";
import { removeTempDir } from "../helpers/temp-dir.js";

let dir: string;
let home: string;
let tokenFile: string;
const hubs: HubHandle[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ndx-hub-handover-"));
  home = join(dir, "home");
  tokenFile = join(home, "auth.token");
});

afterEach(async () => {
  while (hubs.length) await hubs.pop()!.close({ stopChildren: true });
  await removeTempDir(dir);
});

async function hub(port = 0): Promise<HubHandle> {
  const handle = await startHub({ port, homeDir: home, tokenFile, keepAlive: true, healthIntervalMs: 60_000, ndxCli: null });
  hubs.push(handle);
  return handle;
}

async function stop(handle: HubHandle): Promise<void> {
  hubs.splice(hubs.indexOf(handle), 1);
  await handle.close({ stopChildren: true });
}

const token = (): string => readFileSync(tokenFile, "utf-8").trim();

/**
 * One request on a fresh connection. fetch's keep-alive pool would hand the
 * next hub on the same port a socket the previous one closed.
 */
function call(port: number, method: string, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, method, path, headers, agent: false }, (res) => {
      let text = "";
      res.setEncoding("utf-8");
      res.on("data", (c) => { text += c; });
      res.on("end", () => {
        let body: unknown = null;
        try { body = JSON.parse(text); } catch { body = null; }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function signIn(port: number): Promise<string> {
  const { nonce } = (await call(port, "POST", "/api/auth/nonce", { "X-Ndx-Token": token() })).body;
  const { credential } = (await call(port, "POST", "/api/auth/session", { "X-Ndx-Nonce": nonce })).body;
  return credential;
}

const asSession = (port: number, credential: string) => call(port, "GET", "/api/hub/health", { Authorization: `Bearer ${credential}` });

const handOver = (port: number, credential: string) => call(port, "POST", "/api/hub/handover", { "X-Ndx-Token": credential });

describe("hub session hand-over", () => {
  it("keeps a signed-in tab signed in across a replacement, through an owner-only file holding no credential", async () => {
    const old = await hub();
    const port = old.port;
    const credential = await signIn(port);
    expect((await asSession(port, credential)).status).toBe(200);

    // A browser session cannot ask for it; the per-user token can.
    expect((await handOver(port, credential)).status).toBe(403);
    const answer = await handOver(port, token());
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ written: 1 });

    const file = join(home, SESSION_HANDOVER_FILE);
    const text = readFileSync(file, "utf-8");
    expect(text).not.toContain(credential);
    expect(text).not.toContain(token());
    expect(text).not.toMatch(/nonce|ticket/i);
    if (process.platform !== "win32") expect(statSync(file).mode & 0o077).toBe(0);

    await stop(old);
    const next = await hub(port);
    // Taken and deleted at startup.
    expect(existsSync(file)).toBe(false);
    expect((await asSession(next.port, credential)).status).toBe(200);
    // A wrong credential is still refused.
    expect((await asSession(next.port, credential.slice(0, -1) + (credential.endsWith("A") ? "B" : "A"))).status).toBe(401);
  });

  it("signs every tab out on a plain stop and start, with no hand-over", async () => {
    const old = await hub();
    const port = old.port;
    const credential = await signIn(port);
    await stop(old);
    const next = await hub(port);
    expect((await asSession(next.port, credential)).status).toBe(401);
  });

  it("ignores, and deletes, a hand-over that is stale or written for another home, port or token", async () => {
    const old = await hub();
    const port = old.port;
    const credential = await signIn(port);
    await stop(old);

    const sessions = new CredentialStore({ sha256: (v) => v }).exportSessions();
    expect(sessions).toEqual([]);
    const file = join(home, SESSION_HANDOVER_FILE);
    const cases: Array<[string, () => void]> = [
      ["stale", () => writeSessionHandover({ home, port, token: token(), now: () => Date.now() - SESSION_HANDOVER_MAX_AGE_MS - 1_000 }, [])],
      ["other port", () => writeSessionHandover({ home, port: port + 1, token: token() }, [])],
      ["other home", () => writeSessionHandover({ home: join(dir, "other-home"), port, token: token() }, [])],
      ["other token", () => writeSessionHandover({ home, port, token: "x".repeat(43) }, [])],
    ];
    for (const [name, write] of cases) {
      write();
      if (name === "other home") {
        // Written into the other home: move it where this hub looks.
        writeFileSync(file, readFileSync(join(dir, "other-home", SESSION_HANDOVER_FILE)));
      }
      const taken = takeSessionHandover({ home, port, token: token() });
      expect(taken.taken, name).toBe(false);
      expect(existsSync(file), name).toBe(false);
    }

    // And a real one carrying this session, but stale, signs nobody in.
    writeFileSync(file, JSON.stringify({ schema: "ndx/hub-session-handover/v1", home, port, tokenId: "0", writtenAt: 0, sessions: [] }), { mode: 0o600 });
    const next = await hub(port);
    expect(existsSync(file)).toBe(false);
    expect((await asSession(next.port, credential)).status).toBe(401);
  });
});
