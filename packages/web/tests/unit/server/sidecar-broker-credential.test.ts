/**
 * The broker credential matches one raw request-target: `POST` to its own
 * session's `/mcp`. Raw targets a `fetch` would normalise are built by hand.
 */

import { describe, expect, it } from "vitest";
import { isSidecarBrokerRequest, sidecarBrokerCredential, SIDECAR_BROKER_KEY_HEADER } from "../../../src/server/sidecar/broker-credential.js";

function req(method: string, url: string, key: string | string[] | undefined) {
  return { method, url, headers: key === undefined ? {} : { [SIDECAR_BROKER_KEY_HEADER]: key } };
}

describe("isSidecarBrokerRequest", () => {
  const key = sidecarBrokerCredential("cred-a");
  const other = sidecarBrokerCredential("cred-b");

  it("is stable per session and distinct between sessions", () => {
    expect(sidecarBrokerCredential("cred-a")).toBe(key);
    expect(other).not.toBe(key);
  });

  it("accepts the session's own key on POST to its /mcp, with or without a query", () => {
    expect(isSidecarBrokerRequest(req("POST", "/api/sidecar/sessions/cred-a/mcp", key))).toBe(true);
    expect(isSidecarBrokerRequest(req("post", "/api/sidecar/sessions/cred-a/mcp?x=1", key))).toBe(true);
  });

  it.each([
    ["GET", "/api/sidecar/sessions/cred-a/mcp"],
    ["POST", "/api/sidecar/sessions/cred-b/mcp"],
    ["POST", "/api/sidecar/sessions/cred-a/turns"],
    ["POST", "/api/sidecar/sessions/cred-a/mcp/"],
    ["POST", "/api/sidecar/sessions/cred-a/mcp/../../../rex/items"],
    ["POST", "/api/sidecar/sessions/cred-a/mcp%2F..%2F..%2Fturns"],
    ["POST", "/w/main/api/sidecar/sessions/cred-a/mcp"],
    ["POST", "//api/sidecar/sessions/cred-a/mcp"],
    ["POST", "/api/sidecar/sessions/never-minted/mcp"],
  ])("refuses %s %s", (method, url) => {
    expect(isSidecarBrokerRequest(req(method, url, key))).toBe(false);
  });

  it("refuses a missing, wrong, other session's or duplicated key", () => {
    const url = "/api/sidecar/sessions/cred-a/mcp";
    expect(isSidecarBrokerRequest(req("POST", url, undefined))).toBe(false);
    expect(isSidecarBrokerRequest(req("POST", url, "nope"))).toBe(false);
    expect(isSidecarBrokerRequest(req("POST", url, other))).toBe(false);
    expect(isSidecarBrokerRequest(req("POST", url, [key, key]))).toBe(false);
  });
});
