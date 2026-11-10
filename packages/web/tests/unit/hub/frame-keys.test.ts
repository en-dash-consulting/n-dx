/**
 * Frame keys (hub/frame-keys.ts): issue, the sliding idle window and the hard
 * cap, binding to one extension, revocation; and how `decideProxy` routes a
 * keyed path. The proxy and route behaviour over sockets is in
 * tests/integration/hub-frame-keys.test.ts.
 */

import { describe, it, expect } from "vitest";
import { FrameKeys, FRAME_KEY_HARD_CAP_MS, decideProxy, parseKeyedPath, resolveFrameUrl } from "../../../src/hub/index.js";
import type { Hub } from "../../../src/hub/index.js";

const MINUTE = 60_000;

function clock(): { now: () => number; advance: (ms: number) => void } {
  let t = 1_000_000;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe("FrameKeys", () => {
  it("issues 32 random bytes as base64url, distinct each time", () => {
    const keys = new FrameKeys();
    const a = keys.issue("recon", "alpha", 15 * MINUTE).key;
    const b = keys.issue("recon", "alpha", 15 * MINUTE).key;
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a, "base64url")).toHaveLength(32);
    expect(a).not.toBe(b);
  });

  it("accepts a key only for the extension it is bound to", () => {
    const keys = new FrameKeys();
    const { key } = keys.issue("recon", "alpha", 15 * MINUTE);
    expect(keys.accept("recon", key)).toBe(true);
    expect(keys.accept("other", key)).toBe(false);
    expect(keys.accept("recon", "not-a-key")).toBe(false);
  });

  it("goes stale after idleMs without use, and each use slides the window", () => {
    const c = clock();
    const keys = new FrameKeys({ now: c.now });
    const issued = keys.issue("recon", "alpha", 15 * MINUTE);
    expect(issued.expiresAt).toBe(c.now() + 15 * MINUTE);

    c.advance(14 * MINUTE);
    expect(keys.accept("recon", issued.key)).toBe(true);
    c.advance(14 * MINUTE);
    expect(keys.isLive("recon", issued.key)).toBe(true);
    c.advance(MINUTE);
    expect(keys.isLive("recon", issued.key)).toBe(false);
    expect(keys.accept("recon", issued.key)).toBe(false);
  });

  it("goes stale at the hard cap however busy it is", () => {
    const c = clock();
    const keys = new FrameKeys({ now: c.now, hardCapMs: 30 * MINUTE });
    const { key } = keys.issue("recon", "alpha", 15 * MINUTE);
    for (let i = 0; i < 2; i++) {
      c.advance(10 * MINUTE);
      expect(keys.accept("recon", key)).toBe(true);
    }
    c.advance(10 * MINUTE);
    expect(keys.accept("recon", key)).toBe(false);
  });

  it("has an hours-long hard cap by default", () => {
    expect(FRAME_KEY_HARD_CAP_MS).toBe(8 * 60 * MINUTE);
  });

  it("revoke drops every key of one extension and none of another's", () => {
    const keys = new FrameKeys();
    const a = keys.issue("recon", "alpha", 15 * MINUTE).key;
    const b = keys.issue("recon", "beta", 15 * MINUTE).key;
    const other = keys.issue("other", "alpha", 15 * MINUTE).key;
    expect(keys.revoke("recon")).toBe(2);
    expect(keys.isLive("recon", a)).toBe(false);
    expect(keys.isLive("recon", b)).toBe(false);
    expect(keys.isLive("other", other)).toBe(true);
  });
});

describe("parseKeyedPath and resolveFrameUrl", () => {
  it("splits /x/<name>/~f/<key>/… and refuses anything else", () => {
    expect(parseKeyedPath("/x/recon/~f/AbC_-9/tab")).toEqual({ name: "recon", key: "AbC_-9", rest: "/tab" });
    expect(parseKeyedPath("/x/recon/~f/AbC")).toEqual({ name: "recon", key: "AbC", rest: undefined });
    expect(parseKeyedPath("/x/recon/tab")).toBeNull();
    expect(parseKeyedPath("/x/recon/~f/a.b/")).toBeNull();
    expect(parseKeyedPath("/p/alpha/x/recon/~f/AbC/")).toBeNull();
  });

  it("puts the key in the mount and fills the tab path for the project", () => {
    expect(resolveFrameUrl("recon", "K", "/tab?p={projectId}&r={repoRoot}", { id: "alpha", repoRoot: "/r o" }))
      .toBe("/x/recon/~f/K/tab?p=alpha&r=%2Fr%20o");
  });
});

describe("decideProxy: a keyed sidecar path", () => {
  const hub = { listProjects: () => [], getProject: () => undefined } as unknown as Hub;

  it("strips ~f/<key> from the forwarded path and keeps it in the mount", () => {
    expect(decideProxy(hub, "/x/recon/~f/KEY/tab?a=1&ndx_token=T")).toEqual({
      kind: "sidecar", name: "recon", path: "/tab?a=1", prefix: "/x/recon/~f/KEY", frameKey: "KEY",
    });
  });

  it("redirects the bare keyed mount to its trailing slash, and serves an upgrade on it as /", () => {
    expect(decideProxy(hub, "/x/recon/~f/KEY?q=2")).toEqual({ kind: "redirect", location: "/x/recon/~f/KEY/?q=2" });
    expect(decideProxy(hub, "/x/recon/~f/KEY", true)).toMatchObject({ kind: "sidecar", path: "/", frameKey: "KEY" });
  });

  it("leaves an unkeyed path without a frame key", () => {
    expect(decideProxy(hub, "/x/recon/tab")).toEqual({ kind: "sidecar", name: "recon", path: "/tab", prefix: "/x/recon" });
  });
});
