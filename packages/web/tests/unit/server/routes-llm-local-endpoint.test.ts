/**
 * The shape checks behind the local LLM probes. Host and port are spliced
 * into `http://${host}:${port}/v1/…`, so a host that the URL parser would
 * read as anything other than a hostname — a path, a query, credentials,
 * a second port — must be refused before a request is built from it.
 *
 * This is a shape check, not an allowlist: a LAN GPU box is a supported
 * configuration, so any resolvable-looking hostname passes.
 */

import { describe, it, expect } from "vitest";
import { isPlausibleLlmHost, isValidPort } from "../../../src/server/routes-llm.js";

describe("isPlausibleLlmHost", () => {
  it.each(["localhost", "127.0.0.1", "[::1]", "gpu-box.lan", "10.0.0.5", "GPU-Box.lan", "my_host", "a.b.c.example"])(
    "accepts %j",
    (host) => {
      expect(isPlausibleLlmHost(host)).toBe(true);
    },
  );

  it.each([
    ["127.0.0.1/x?", "a path and query"],
    ["u@127.0.0.1", "credentials"],
    ["localhost:9999", "a port"],
    ["a b", "whitespace"],
    ["host\tname", "a tab"],
    ["evil.com#x", "a fragment"],
    ["127.0.0.1\\x", "a backslash"],
    ["::1", "an unbracketed IPv6 address"],
    ["[::1", "an unclosed bracket"],
    ["", "nothing"],
    ["a".repeat(254), "more than a DNS name can hold"],
  ])("rejects %j (%s)", (host) => {
    expect(isPlausibleLlmHost(host)).toBe(false);
  });

  it("rejects anything that is not a string", () => {
    for (const value of [undefined, null, 1234, {}, ["localhost"]]) {
      expect(isPlausibleLlmHost(value)).toBe(false);
    }
  });
});

describe("isValidPort", () => {
  it("accepts an integer from 1 to 65535", () => {
    for (const port of [1, 80, 1234, 11434, 65535]) expect(isValidPort(port)).toBe(true);
  });

  it("rejects out-of-range, fractional, non-finite and non-number values", () => {
    for (const port of [0, -1, 65536, 70000, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1234", null, undefined]) {
      expect(isValidPort(port)).toBe(false);
    }
  });
});
