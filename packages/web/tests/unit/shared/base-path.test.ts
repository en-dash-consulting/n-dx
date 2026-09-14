/**
 * Base-path derivation — the pure functions behind hub-hosted viewers.
 *
 * Served behind the hub the viewer lives under /p/<id>/ and derives that
 * prefix from its own pathname; served directly it derives "". These
 * helpers feed the fetch adapter, the WebSocket URL, and every
 * history.pushState — a wrong answer here mislabels every URL the app
 * touches, so the edge shapes are pinned exhaustively.
 *
 * @see packages/web/src/shared/base-path.ts
 * @see packages/web/src/viewer/base-path.ts — the boot-time consumer
 */

import { describe, it, expect } from "vitest";
import { deriveBasePath, stripBasePath, joinBasePath } from "../../../src/shared/base-path.js";

describe("deriveBasePath", () => {
  it.each([
    ["/p/alpha/", "/p/alpha"],
    ["/p/alpha/prd", "/p/alpha"],
    ["/p/alpha/prd/task-1", "/p/alpha"],
    ["/p/my.project-2/overview", "/p/my.project-2"],
    ["/p/alpha", "/p/alpha"],
  ])("derives the project base from %s", (pathname, expected) => {
    expect(deriveBasePath(pathname)).toBe(expected);
  });

  it.each([
    ["/"],
    ["/prd"],
    ["/prd/task-1"],
    ["/overview"],
    // "p" alone is not a project prefix
    ["/p"],
    ["/p/"],
    // a view that merely starts with p
    ["/performance"],
  ])("derives no base from %s (direct serve)", (pathname) => {
    expect(deriveBasePath(pathname)).toBe("");
  });
});

describe("stripBasePath", () => {
  it("removes the base and keeps the route root-form", () => {
    expect(stripBasePath("/p/alpha/prd/task-1", "/p/alpha")).toBe("/prd/task-1");
    expect(stripBasePath("/p/alpha/", "/p/alpha")).toBe("/");
    expect(stripBasePath("/p/alpha", "/p/alpha")).toBe("/");
  });

  it("is the identity with an empty base or a foreign path", () => {
    expect(stripBasePath("/prd", "")).toBe("/prd");
    expect(stripBasePath("/other/route", "/p/alpha")).toBe("/other/route");
  });

  it("round-trips with deriveBasePath for any served pathname", () => {
    for (const pathname of ["/p/alpha/prd", "/prd", "/", "/p/x/hench-runs/run-9"]) {
      const base = deriveBasePath(pathname);
      const stripped = stripBasePath(pathname, base);
      expect(stripped.startsWith("/")).toBe(true);
      expect(joinBasePath(base, stripped)).toBe(pathname);
    }
  });
});

describe("joinBasePath", () => {
  it("prefixes root-absolute paths", () => {
    expect(joinBasePath("/p/alpha", "/api/status")).toBe("/p/alpha/api/status");
    expect(joinBasePath("/p/alpha", "/prd/task-1")).toBe("/p/alpha/prd/task-1");
  });

  it("is the identity with an empty base", () => {
    expect(joinBasePath("", "/api/status")).toBe("/api/status");
  });

  it("never double-prefixes", () => {
    expect(joinBasePath("/p/alpha", "/p/alpha/api/status")).toBe("/p/alpha/api/status");
    expect(joinBasePath("/p/alpha", "/p/alpha")).toBe("/p/alpha");
  });

  it("leaves non-root-absolute inputs alone", () => {
    expect(joinBasePath("/p/alpha", "http://127.0.0.1:3117/api/x")).toBe("http://127.0.0.1:3117/api/x");
    expect(joinBasePath("/p/alpha", "./relative.png")).toBe("./relative.png");
  });

  it("keeps query strings attached", () => {
    expect(joinBasePath("/p/alpha", "/api/search?q=x")).toBe("/p/alpha/api/search?q=x");
  });
});
