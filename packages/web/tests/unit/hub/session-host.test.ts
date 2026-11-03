/**
 * The hub session's host lock: one live holder, named by pid and port; a dead
 * holder is replaced and the new holder is told it acquired the lock, so it
 * rereads the session from disk.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claimHubSessionHost,
  HubSessionHostPicker,
  hubSessionHostLockPath,
  probeHubLens,
  readHubSessionHostLock,
  type ProjectView,
} from "../../../src/hub/index.js";
import { FEATURE_DISABLED_HEADER } from "../../../src/shared/index.js";

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

/** A healthy registered project on `port`. Only what the picker reads is real. */
function project(id: string, port: number): ProjectView {
  return {
    id, port,
    status: { state: "healthy", pid: null, port, attached: false, respawns: 0, lastHealthAt: "t1", lastError: null },
  } as unknown as ProjectView;
}

const lensAnswer = (available: boolean): Response =>
  new Response(JSON.stringify({ lens: { id: "hub", available }, ceiling: 40_000 }), { status: 200 });

describe("probeHubLens", () => {
  it("asks the picked host's lens route with the hub token, and offers the session only when the hub lens is available", async () => {
    const seen: Array<{ url: string; token: string | null }> = [];
    const fetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url, token: new Headers(init?.headers).get("X-Ndx-Token") });
      return lensAnswer(true);
    }) as typeof globalThis.fetch;
    expect(await probeHubLens(new HubSessionHostPicker(home), [project("a", 4001)], { token: "tok", fetch })).toBe(true);
    expect(seen).toEqual([{ url: "http://127.0.0.1:4001/api/sidecar/hub/lens", token: "tok" }]);

    const unavailable = (async () => lensAnswer(false)) as unknown as typeof globalThis.fetch;
    expect(await probeHubLens(new HubSessionHostPicker(home), [project("a", 4001)], { fetch: unavailable })).toBe(false);
  });

  it("is false with no healthy project to ask", async () => {
    const fetch = (async () => { throw new Error("must not be asked"); }) as typeof globalThis.fetch;
    expect(await probeHubLens(new HubSessionHostPicker(home), [], { fetch })).toBe(false);
  });

  it("passes over a host with web.sidecar off, and one that does not answer, as the proxy does", async () => {
    const asked: number[] = [];
    const fetch = (async (url: string) => {
      const port = Number(new URL(url).port);
      asked.push(port);
      if (port === 4001) return new Response("{}", { status: 403, headers: { [FEATURE_DISABLED_HEADER]: "web.sidecar" } });
      if (port === 4002) throw new TypeError("fetch failed");
      return lensAnswer(true);
    }) as typeof globalThis.fetch;
    const picker = new HubSessionHostPicker(home);
    const projects = [project("a", 4001), project("b", 4002), project("c", 4003)];
    expect(await probeHubLens(picker, projects, { fetch })).toBe(true);
    expect(asked).toEqual([4001, 4002, 4003]);
    // The skips stick until a newer health check, so the session's own requests go to the same host.
    expect(picker.pick(projects)?.port).toBe(4003);
  });

  it("leaves a host that answers too slowly where it is, rather than moving the session off it", async () => {
    const asked: number[] = [];
    const fetch = (async (url: string) => {
      asked.push(Number(new URL(url).port));
      throw new DOMException("The operation timed out.", "TimeoutError");
    }) as typeof globalThis.fetch;
    const picker = new HubSessionHostPicker(home);
    const projects = [project("a", 4001), project("b", 4002)];
    expect(await probeHubLens(picker, projects, { fetch })).toBe(false);
    // One wait, not one per project, and the slow host still gets the session's requests.
    expect(asked).toEqual([4001]);
    expect(picker.pick(projects)?.port).toBe(4001);
  });

  it("is false when every host has web.sidecar off", async () => {
    const fetch = (async () => new Response("{}", { status: 403, headers: { [FEATURE_DISABLED_HEADER]: "web.sidecar" } })) as unknown as typeof globalThis.fetch;
    const picker = new HubSessionHostPicker(home);
    const projects = [project("a", 4001), project("b", 4002)];
    expect(await probeHubLens(picker, projects, { fetch })).toBe(false);
    expect(picker.sidecarOffEverywhere(projects)).toBe(true);
  });
});
