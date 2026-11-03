/**
 * The hub session's host lock: one live holder, named by pid and port; a dead
 * holder is replaced and the new holder is told it acquired the lock, so it
 * rereads the session from disk.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claimHubSessionHost, hubSessionHostLockPath, readHubSessionHostLock } from "../../../src/hub/index.js";

let home: string;
const alive = new Set<number>();
const isAlive = (pid: number): boolean => alive.has(pid);

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "hub-session-host-"));
  alive.clear();
  alive.add(11).add(22);
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("claimHubSessionHost", () => {
  it("takes a free lock, keeps it on the next claim, and refuses a second live server", () => {
    expect(claimHubSessionHost(home, { pid: 11, port: 4000, isAlive })).toMatchObject({ held: true, acquired: true, lock: { pid: 11, port: 4000 } });
    expect(claimHubSessionHost(home, { pid: 11, port: 4000, isAlive })).toMatchObject({ held: true, acquired: false });
    expect(claimHubSessionHost(home, { pid: 22, port: 5000, isAlive })).toMatchObject({ held: false, holder: { pid: 11, port: 4000 } });
  });

  it("replaces a dead holder, and a half-written lock", () => {
    claimHubSessionHost(home, { pid: 11, port: 4000, isAlive });
    alive.delete(11);
    expect(claimHubSessionHost(home, { pid: 22, port: 5000, isAlive })).toMatchObject({ held: true, acquired: true });
    expect(readHubSessionHostLock(home)).toMatchObject({ pid: 22, port: 5000 });

    mkdirSync(join(home, "hub", "sidecar"), { recursive: true });
    writeFileSync(hubSessionHostLockPath(home), "{");
    expect(claimHubSessionHost(home, { pid: 11, port: 4001, isAlive: () => true })).toMatchObject({ held: true, acquired: true });
  });

  it("moves its own lock to a new port without counting it as newly acquired", () => {
    claimHubSessionHost(home, { pid: 11, port: 4000, isAlive });
    expect(claimHubSessionHost(home, { pid: 11, port: 4100, isAlive })).toMatchObject({ held: true, acquired: false, lock: { port: 4100 } });
  });
});
