import { describe, it, expect } from "vitest";
import {
  detectBasePath,
  projectIdFromBasePath,
  stripBasePath,
  webSocketUrl,
  withBasePath,
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
