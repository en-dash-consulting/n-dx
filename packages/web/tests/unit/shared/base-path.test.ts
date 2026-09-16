import { describe, it, expect } from "vitest";
import {
  detectBasePath,
  detectViewerBasePath,
  projectIdFromBasePath,
  stripBasePath,
  stripWorkspaceSlot,
  webSocketUrl,
  withBasePath,
  workspaceKeyFromBasePath,
} from "../../../src/shared/index.js";

describe("base-path", () => {
  it("detects a project prefix and nothing at the root", () => {
    expect(detectBasePath("/")).toBe("");
    expect(detectBasePath("/prd/123")).toBe("");
    expect(detectBasePath("/p/alpha")).toBe("/p/alpha");
    expect(detectBasePath("/p/alpha/")).toBe("/p/alpha");
    expect(detectBasePath("/p/alpha/hench-runs/run-1?x=1")).toBe("/p/alpha");
    // `/p` alone or `/prefix` are not project paths.
    expect(detectBasePath("/p")).toBe("");
    expect(detectBasePath("/p/")).toBe("");
    expect(detectBasePath("/plans")).toBe("");
  });

  it("extracts the project id, decoding it", () => {
    expect(projectIdFromBasePath("/p/alpha")).toBe("alpha");
    expect(projectIdFromBasePath("/p/my%20repo")).toBe("my repo");
    expect(projectIdFromBasePath("")).toBeNull();
  });

  it("prefixes root-relative URLs only, and never twice", () => {
    expect(withBasePath("", "/api/status")).toBe("/api/status");
    expect(withBasePath("/p/a", "/api/status")).toBe("/p/a/api/status");
    expect(withBasePath("/p/a", "/api/hench/runs?scope=repo")).toBe("/p/a/api/hench/runs?scope=repo");
    expect(withBasePath("/p/a", "/p/a/api/status")).toBe("/p/a/api/status");
    expect(withBasePath("/p/a", "/p/a")).toBe("/p/a");
    expect(withBasePath("/p/a", "http://example.test/api")).toBe("http://example.test/api");
    expect(withBasePath("/p/a", "//cdn.example/x.js")).toBe("//cdn.example/x.js");
    expect(withBasePath("/p/a", "./n-dx.png")).toBe("./n-dx.png");
    // A different project's prefix is still a root-relative path from this one's view.
    expect(withBasePath("/p/a", "/p/b/api")).toBe("/p/a/p/b/api");
  });

  it("strips the base path down to a root-relative pathname", () => {
    expect(stripBasePath("", "/prd/1")).toBe("/prd/1");
    expect(stripBasePath("/p/a", "/p/a")).toBe("/");
    expect(stripBasePath("/p/a", "/p/a/")).toBe("/");
    expect(stripBasePath("/p/a", "/p/a/prd/1")).toBe("/prd/1");
    expect(stripBasePath("/p/a", "/p/ab/prd")).toBe("/p/ab/prd");
    expect(stripBasePath("/p/a", "/other")).toBe("/other");
  });

  it("round-trips: strip(with(x)) is x for root-relative paths", () => {
    for (const path of ["/", "/api/status", "/prd/abc", "/data/prd.json?x=1"]) {
      const [pathname] = path.split("?");
      expect(stripBasePath("/p/z", withBasePath("/p/z", pathname))).toBe(pathname);
    }
  });

  it("builds the socket URL under the base path", () => {
    expect(webSocketUrl("http:", "localhost:3117", "")).toBe("ws://localhost:3117");
    expect(webSocketUrl("https:", "host", "/p/a")).toBe("wss://host/p/a");
  });
});

describe("workspace slot", () => {
  it("detectViewerBasePath composes the project prefix and the workspace slot", () => {
    expect(detectViewerBasePath("/prd/1")).toBe("");
    expect(detectViewerBasePath("/w/feature/prd/1")).toBe("/w/feature");
    expect(detectViewerBasePath("/w/feature")).toBe("/w/feature");
    expect(detectViewerBasePath("/p/app/prd")).toBe("/p/app");
    expect(detectViewerBasePath("/p/app/w/feature/prd")).toBe("/p/app/w/feature");
    // A /w/ that is not the leading slot is a view path, not a workspace.
    expect(detectViewerBasePath("/prd/w/feature")).toBe("");
    expect(detectViewerBasePath("/workspaces")).toBe("");
  });

  it("workspaceKeyFromBasePath reads the key, decoded, or null for the anchor", () => {
    expect(workspaceKeyFromBasePath("")).toBeNull();
    expect(workspaceKeyFromBasePath("/p/app")).toBeNull();
    expect(workspaceKeyFromBasePath("/w/feature")).toBe("feature");
    expect(workspaceKeyFromBasePath("/p/app/w/my%20tree")).toBe("my tree");
  });

  it("stripWorkspaceSlot splits the server-side URL and keeps the query", () => {
    expect(stripWorkspaceSlot("/api/status")).toEqual({ key: null, url: "/api/status" });
    expect(stripWorkspaceSlot("/w/feature/api/status")).toEqual({ key: "feature", url: "/api/status" });
    expect(stripWorkspaceSlot("/w/feature")).toEqual({ key: "feature", url: "/" });
    expect(stripWorkspaceSlot("/w/feature/")).toEqual({ key: "feature", url: "/" });
    expect(stripWorkspaceSlot("/w/feature?x=1")).toEqual({ key: "feature", url: "/?x=1" });
    expect(stripWorkspaceSlot("/w/feature/data/prd.json?t=2")).toEqual({ key: "feature", url: "/data/prd.json?t=2" });
    expect(stripWorkspaceSlot("/w/my%20tree/prd")).toEqual({ key: "my tree", url: "/prd" });
    expect(stripWorkspaceSlot("/workspaces")).toEqual({ key: null, url: "/workspaces" });
  });

  it("the viewer base round-trips through withBasePath and stripBasePath with the slot", () => {
    const base = detectViewerBasePath("/p/app/w/feature/hench-runs/run-1");
    expect(withBasePath(base, "/api/hench/runs")).toBe("/p/app/w/feature/api/hench/runs");
    expect(stripBasePath(base, "/p/app/w/feature/hench-runs/run-1")).toBe("/hench-runs/run-1");
  });
});
