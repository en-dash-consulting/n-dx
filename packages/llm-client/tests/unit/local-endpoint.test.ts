/**
 * The shape rule for the local LLM endpoint. Host and port are spliced into
 * `http://${host}:${port}/v1/…` by inference, by the dashboard's probes and
 * by `ndx config`, so a host the URL parser would read as anything other
 * than a hostname — a path, a query, credentials, a second port — must be
 * refused before a request is built from it.
 *
 * This is a shape check, not an allowlist: a LAN GPU box is a supported
 * configuration, so any resolvable-looking hostname passes.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_LOCAL_HOST,
  DEFAULT_LOCAL_PORT,
  describeLocalEndpointProblem,
  isPlausibleLlmHost,
  isValidPort,
} from "../../src/local-endpoint.js";

describe("isPlausibleLlmHost", () => {
  it.each([
    "localhost",
    "127.0.0.1",
    "[::1]",
    "gpu-box.lan",
    "10.0.0.5",
    "GPU-Box.LAN",
    "my_host",
    "a.b.c.example",
    "127.1",
    "[0:0:0:0:0:0:0:1]",
    "bücher.lan",
  ])("accepts %j", (host) => {
    expect(isPlausibleLlmHost(host)).toBe(true);
  });

  it.each([
    ["127.0.0.1/x?", "a path and query"],
    ["u@127.0.0.1", "credentials"],
    ["localhost:9999", "a port"],
    ["[::1]:80", "a bracketed address with a port"],
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
    for (const value of [undefined, null, 1234, 127.1, {}, ["localhost"]]) {
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

describe("describeLocalEndpointProblem", () => {
  it("is silent for the defaults and for a LAN box", () => {
    expect(describeLocalEndpointProblem(DEFAULT_LOCAL_HOST, DEFAULT_LOCAL_PORT)).toBeNull();
    expect(describeLocalEndpointProblem("gpu-box.lan", 11434)).toBeNull();
  });

  it("names the host, quoted as written", () => {
    const problem = describeLocalEndpointProblem("u@127.0.0.1", 1234);
    expect(problem).toContain("Invalid LLM host");
    expect(problem).toContain('"u@127.0.0.1"');
  });

  it("names a string-typed port rather than coercing it", () => {
    const problem = describeLocalEndpointProblem("localhost", "1234");
    expect(problem).toContain("Invalid LLM port");
    expect(problem).toContain('"1234"');
  });

  it("reports the host first when both fail", () => {
    expect(describeLocalEndpointProblem("a b", 0)).toContain("Invalid LLM host");
  });
});
