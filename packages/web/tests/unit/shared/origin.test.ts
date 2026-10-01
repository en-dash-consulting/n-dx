/**
 * The loopback rules both servers share: a request's `Host` must name loopback
 * on the server's own port, and a browser `Origin` must do the same.
 */

import { describe, expect, it } from "vitest";
import { isLoopbackHostOnPort, isLoopbackOriginOnPort } from "../../../src/shared/origin.js";

const PORT = 3117;

describe("isLoopbackHostOnPort", () => {
  it("accepts the loopback names a browser could legitimately send, on this port", () => {
    expect(isLoopbackHostOnPort("localhost:3117", PORT)).toBe(true);
    expect(isLoopbackHostOnPort("127.0.0.1:3117", PORT)).toBe(true);
    expect(isLoopbackHostOnPort("[::1]:3117", PORT)).toBe(true);
    // Hostnames are case-insensitive.
    expect(isLoopbackHostOnPort("LocalHost:3117", PORT)).toBe(true);
  });

  it("refuses a non-loopback host", () => {
    expect(isLoopbackHostOnPort("attacker.example:3117", PORT)).toBe(false);
    // A subdomain of localhost is not localhost.
    expect(isLoopbackHostOnPort("evil.localhost:3117", PORT)).toBe(false);
    expect(isLoopbackHostOnPort("localhost.attacker.example:3117", PORT)).toBe(false);
  });

  it("refuses a loopback name on another port, or with no port", () => {
    expect(isLoopbackHostOnPort("localhost:3118", PORT)).toBe(false);
    // No port means 80, which is not this server.
    expect(isLoopbackHostOnPort("localhost", PORT)).toBe(false);
    expect(isLoopbackHostOnPort("127.0.0.1", PORT)).toBe(false);
  });

  it("refuses a missing, empty, or duplicated Host and an unknown port", () => {
    expect(isLoopbackHostOnPort(undefined, PORT)).toBe(false);
    expect(isLoopbackHostOnPort("", PORT)).toBe(false);
    // The caller passes undefined for an array-valued header.
    expect(isLoopbackHostOnPort("localhost:3117", undefined)).toBe(false);
  });

  it("refuses spellings the URL parser would quietly normalise", () => {
    // Each of these parses to a loopback authority but is not what was sent;
    // accepting them would mean trusting the parser's idea of the host over
    // the client's. Nothing legitimate sends them.
    expect(isLoopbackHostOnPort("user@localhost:3117", PORT)).toBe(false);
    expect(isLoopbackHostOnPort("localhost:3117/path", PORT)).toBe(false);
    expect(isLoopbackHostOnPort("localhost:3117?x", PORT)).toBe(false);
    expect(isLoopbackHostOnPort("127.1:3117", PORT)).toBe(false);
    expect(isLoopbackHostOnPort("0x7f.0.0.1:3117", PORT)).toBe(false);
    expect(isLoopbackHostOnPort("2130706433:3117", PORT)).toBe(false);
    expect(isLoopbackHostOnPort("[0:0:0:0:0:0:0:1]:3117", PORT)).toBe(false);
    expect(isLoopbackHostOnPort("localhost:03117", PORT)).toBe(false);
  });

  it("refuses garbage rather than throwing", () => {
    expect(isLoopbackHostOnPort("not a host", PORT)).toBe(false);
    expect(isLoopbackHostOnPort("::", PORT)).toBe(false);
    expect(isLoopbackHostOnPort("localhost:notaport", PORT)).toBe(false);
  });
});

describe("isLoopbackOriginOnPort", () => {
  it("still trusts only plain-HTTP loopback on this port", () => {
    expect(isLoopbackOriginOnPort("http://localhost:3117", PORT)).toBe(true);
    expect(isLoopbackOriginOnPort("http://127.0.0.1:3117", PORT)).toBe(true);
    expect(isLoopbackOriginOnPort("http://[::1]:3117", PORT)).toBe(true);
    expect(isLoopbackOriginOnPort("https://localhost:3117", PORT)).toBe(false);
    expect(isLoopbackOriginOnPort("http://localhost:3118", PORT)).toBe(false);
    expect(isLoopbackOriginOnPort("http://attacker.example:3117", PORT)).toBe(false);
    expect(isLoopbackOriginOnPort("null", PORT)).toBe(false);
    expect(isLoopbackOriginOnPort("http://localhost:3117", undefined)).toBe(false);
  });
});
