/**
 * Viewer base-path runtime — boot-time derivation, the fetch adapter, and
 * the WebSocket URL, with `location` stubbed per test.
 *
 * The adapter is the single seam through which the viewer's ~160
 * root-absolute fetch calls acquire the /p/<id> prefix behind the hub, so
 * the properties pinned here are the load-bearing ones: no-op at the root
 * (direct `web serve` keeps the native fetch untouched), prefixing behind
 * the hub, and hands-off for absolute URLs and non-string inputs.
 *
 * @see packages/web/src/viewer/base-path.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  viewerBasePath,
  resetViewerBasePathForTests,
  withBase,
  getWsUrl,
  installBasePathFetchAdapter,
} from "../../../src/viewer/base-path.js";

const globals = globalThis as { location?: unknown; fetch?: unknown };
const originalLocation = globals.location;
const originalFetch = globals.fetch;

function stubLocation(pathname: string): void {
  globals.location = { pathname, protocol: "http:", host: "127.0.0.1:3117" };
  resetViewerBasePathForTests();
}

/** Install a capturing fetch and return the log of URLs it received. */
function captureFetch(): Array<RequestInfo | URL> {
  const seen: Array<RequestInfo | URL> = [];
  globals.fetch = (input: RequestInfo | URL) => {
    seen.push(input);
    return Promise.resolve(new Response("{}"));
  };
  return seen;
}

afterEach(() => {
  globals.location = originalLocation;
  globals.fetch = originalFetch;
  resetViewerBasePathForTests();
});

describe("viewerBasePath / withBase / getWsUrl", () => {
  it("derives the hub prefix from the document pathname", () => {
    stubLocation("/p/alpha/prd/task-1");
    expect(viewerBasePath()).toBe("/p/alpha");
    expect(withBase("/api/status")).toBe("/p/alpha/api/status");
    expect(getWsUrl()).toBe("ws://127.0.0.1:3117/p/alpha");
  });

  it("derives nothing when served at the root", () => {
    stubLocation("/prd/task-1");
    expect(viewerBasePath()).toBe("");
    expect(withBase("/api/status")).toBe("/api/status");
    expect(getWsUrl()).toBe("ws://127.0.0.1:3117");
  });
});

describe("installBasePathFetchAdapter", () => {
  beforeEach(() => {
    resetViewerBasePathForTests();
  });

  it("is a no-op at the root — the native fetch stays installed", () => {
    stubLocation("/overview");
    const native = captureFetch();
    const installed = globals.fetch;
    installBasePathFetchAdapter();
    expect(globals.fetch).toBe(installed);
    void (globals.fetch as typeof fetch)("/api/status");
    expect(native).toEqual(["/api/status"]);
  });

  it("prefixes root-absolute string URLs behind the hub", async () => {
    stubLocation("/p/alpha/overview");
    const seen = captureFetch();
    installBasePathFetchAdapter();
    const wrapped = globals.fetch as typeof fetch;

    await wrapped("/api/status");
    await wrapped("/data/prd.json?fresh=1");
    // Already-prefixed and absolute URLs pass through untouched.
    await wrapped("/p/alpha/api/other");
    await wrapped("http://127.0.0.1:9999/api/external");

    expect(seen).toEqual([
      "/p/alpha/api/status",
      "/p/alpha/data/prd.json?fresh=1",
      "/p/alpha/api/other",
      "http://127.0.0.1:9999/api/external",
    ]);
  });
});
