/**
 * The hub's origin gate — the thing standing between a web page the user has
 * open and a process spawn.
 *
 * `POST /api/hub/projects` takes `ndxBin`, an absolute path, and the hub
 * executes it (`buildServeCommand` → `spawnManaged`). The hub listens on a
 * fixed well-known port with no authentication, and a `text/plain` POST is a
 * CORS simple request: no preflight, so nothing asks permission before the
 * body arrives. Until this gate existed, visiting a page was enough.
 */

import { describe, it, expect } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { classifyOrigin, guardHubRequest, upgradeAllowed } from "../../../src/hub/request-guard.js";

const HUB_PORT = 3117;

function req(method: string, headers: Record<string, string | string[]> = {}): IncomingMessage {
  // Every real client sends Host. Default it to the hub so the origin tests
  // exercise the origin rule, not the Host rule; the Host tests override it.
  return {
    method,
    headers: { host: `localhost:${HUB_PORT}`, ...headers },
    url: "/api/hub/projects",
  } as unknown as IncomingMessage;
}

interface FakeRes {
  statusCode: number | null;
  headers: Record<string, string>;
  body: string;
  res: ServerResponse;
}

function res(): FakeRes {
  const state: FakeRes = {
    statusCode: null,
    headers: {},
    body: "",
    res: null as unknown as ServerResponse,
  };
  state.res = {
    writeHead(status: number, headers?: Record<string, string>) {
      state.statusCode = status;
      for (const [name, value] of Object.entries(headers ?? {})) state.headers[name.toLowerCase()] = value;
      return this;
    },
    setHeader(name: string, value: string) {
      state.headers[name.toLowerCase()] = value;
    },
    end(text?: string) {
      state.body = text ?? "";
    },
  } as unknown as ServerResponse;
  return state;
}

describe("classifyOrigin", () => {
  it("trusts only loopback HTTP on the hub's own port", () => {
    expect(classifyOrigin(req("POST", { origin: "http://localhost:3117" }), HUB_PORT)).toBe("trusted");
    expect(classifyOrigin(req("POST", { origin: "http://127.0.0.1:3117" }), HUB_PORT)).toBe("trusted");
    expect(classifyOrigin(req("POST", { origin: "https://localhost:3117" }), HUB_PORT)).toBe("untrusted");
    expect(classifyOrigin(req("POST", { origin: "http://localhost:3118" }), HUB_PORT)).toBe("untrusted");
    expect(classifyOrigin(req("POST", { origin: "http://evil.test" }), HUB_PORT)).toBe("untrusted");
    // A rebinding origin cannot present a matching host: the comparison is
    // against the port the hub bound, not the Host header.
    expect(classifyOrigin(req("POST", { origin: "http://attacker.example:3117" }), HUB_PORT)).toBe("untrusted");
    expect(classifyOrigin(req("POST", { origin: "null" }), HUB_PORT)).toBe("untrusted");
  });

  it("reports an absent origin as absent, and a duplicated one as untrusted", () => {
    expect(classifyOrigin(req("POST"), HUB_PORT)).toBe("absent");
    expect(classifyOrigin(req("POST", { origin: ["http://localhost:3117", "http://evil.test"] }), HUB_PORT)).toBe("untrusted");
  });
});

describe("guardHubRequest", () => {
  it("refuses a cross-origin registration — the CSRF-to-process-spawn path", () => {
    const out = res();
    expect(guardHubRequest(req("POST", { origin: "http://evil.test" }), out.res, HUB_PORT)).toBe(true);
    expect(out.statusCode).toBe(403);
    expect(JSON.parse(out.body).error).toMatch(/cross-origin/i);
  });

  it("refuses a cross-site mutation that carries no Origin at all", () => {
    const out = res();
    expect(guardHubRequest(req("POST", { "sec-fetch-site": "cross-site" }), out.res, HUB_PORT)).toBe(true);
    expect(out.statusCode).toBe(403);
  });

  it("lets the dashboard's own origin through and reflects it", () => {
    const out = res();
    expect(guardHubRequest(req("POST", { origin: "http://localhost:3117" }), out.res, HUB_PORT)).toBe(false);
    expect(out.headers["access-control-allow-origin"]).toBe("http://localhost:3117");
    expect(out.headers["vary"]).toBe("Origin");
  });

  it("lets a non-browser client through — the CLI and MCP send no Origin", () => {
    const out = res();
    expect(guardHubRequest(req("POST"), out.res, HUB_PORT)).toBe(false);
    expect(out.statusCode).toBeNull();
  });

  it("does not approve a preflight from an untrusted origin", () => {
    const out = res();
    expect(guardHubRequest(req("OPTIONS", { origin: "http://evil.test" }), out.res, HUB_PORT)).toBe(true);
    expect(out.statusCode).toBe(403);
    expect(out.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("answers a trusted preflight with 204 and the CORS headers", () => {
    const out = res();
    expect(guardHubRequest(req("OPTIONS", { origin: "http://127.0.0.1:3117" }), out.res, HUB_PORT)).toBe(true);
    expect(out.statusCode).toBe(204);
    expect(out.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:3117");
  });

  it("leaves safe cross-origin reads alone but does not reflect them", () => {
    // A page can already navigate here; refusing GET would break the address
    // bar. Without the CORS header it still cannot read the response.
    const out = res();
    expect(guardHubRequest(req("GET", { origin: "http://evil.test" }), out.res, HUB_PORT)).toBe(false);
    expect(out.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("guardHubRequest — Host validation", () => {
  it("answers 421 to a safe-method read whose Host is not the hub", () => {
    const out = res();
    expect(
      guardHubRequest(req("GET", { host: "attacker.example:3117", "sec-fetch-site": "same-origin" }), out.res, HUB_PORT),
    ).toBe(true);
    expect(out.statusCode).toBe(421);
    expect(out.headers["access-control-allow-origin"]).toBeUndefined();
    expect(JSON.parse(out.body)).toEqual({ error: "Request Host does not name this server" });
  });

  it("answers 421 to a mutation whose Host is not the hub, even with a trusted Origin", () => {
    const out = res();
    expect(
      guardHubRequest(req("POST", { host: "attacker.example:3117", origin: "http://localhost:3117" }), out.res, HUB_PORT),
    ).toBe(true);
    expect(out.statusCode).toBe(421);
  });

  it("answers 421 when Host names the right machine on the wrong port, or is missing", () => {
    for (const headers of [{ host: "localhost:3118" }, { host: "localhost" }, { host: "" }]) {
      const out = res();
      expect(guardHubRequest(req("GET", headers), out.res, HUB_PORT), JSON.stringify(headers)).toBe(true);
      expect(out.statusCode, JSON.stringify(headers)).toBe(421);
    }
    const noHost = req("GET");
    delete (noHost.headers as Record<string, unknown>).host;
    const out = res();
    expect(guardHubRequest(noHost, out.res, HUB_PORT)).toBe(true);
    expect(out.statusCode).toBe(421);
  });

  it("lets every loopback spelling of the hub's own port through", () => {
    for (const host of ["localhost:3117", "127.0.0.1:3117", "[::1]:3117", "LOCALHOST:3117"]) {
      const out = res();
      expect(guardHubRequest(req("GET", { host }), out.res, HUB_PORT), host).toBe(false);
      expect(out.statusCode, host).toBeNull();
    }
  });

  it("refuses everything while the hub has not yet bound a port", () => {
    const out = res();
    expect(guardHubRequest(req("GET"), out.res, undefined)).toBe(true);
    expect(out.statusCode).toBe(421);
  });
});

describe("guardHubRequest — per-user token", () => {
  const TOKEN = "hubtok_0123456789abcdefghijklmnopqrstuv";

  it("is inert without a token and refuses with 401 when one is configured", () => {
    const a = res();
    expect(guardHubRequest(req("GET"), a.res, HUB_PORT)).toBe(false);
    const b = res();
    expect(guardHubRequest(req("GET"), b.res, HUB_PORT, TOKEN)).toBe(true);
    expect(b.statusCode).toBe(401);
    expect(b.headers["www-authenticate"]).toContain("Bearer");
  });

  it("accepts the token as bearer, header or cookie, including on the spawn route", () => {
    const carriers: Array<Record<string, string>> = [
      { authorization: `Bearer ${TOKEN}` },
      { "x-ndx-token": TOKEN },
      { cookie: `ndx_token=${TOKEN}` },
    ];
    for (const headers of carriers) {
      const out = res();
      expect(guardHubRequest(req("POST", { ...headers, origin: "http://localhost:3117" }), out.res, HUB_PORT, TOKEN), JSON.stringify(headers)).toBe(false);
    }
  });

  it("sets the cookie and redirects for a navigation that carries the token once", () => {
    const r = req("GET", {}) as IncomingMessage & { url: string };
    r.url = `/p/alpha/?ndx_token=${TOKEN}`;
    const out = res();
    expect(guardHubRequest(r, out.res, HUB_PORT, TOKEN)).toBe(true);
    expect(out.statusCode).toBe(302);
    expect(out.headers["set-cookie"]).toContain(`ndx_token=${TOKEN}`);
    expect(out.headers["location"]).toBe("/p/alpha/");
  });

  it("still applies the Host and Origin rules to an authenticated request", () => {
    const foreignHost = res();
    expect(guardHubRequest(req("GET", { host: "attacker.example:3117", "x-ndx-token": TOKEN }), foreignHost.res, HUB_PORT, TOKEN)).toBe(true);
    expect(foreignHost.statusCode).toBe(421);
    const foreignOrigin = res();
    expect(guardHubRequest(req("POST", { origin: "http://evil.test", "x-ndx-token": TOKEN }), foreignOrigin.res, HUB_PORT, TOKEN)).toBe(true);
    expect(foreignOrigin.statusCode).toBe(403);
  });

  it("requires the token on a WebSocket handshake too", () => {
    expect(upgradeAllowed(req("GET", { origin: "http://localhost:3117" }), HUB_PORT, TOKEN)).toBe(false);
    expect(upgradeAllowed(req("GET", { origin: "http://localhost:3117", cookie: `ndx_token=${TOKEN}` }), HUB_PORT, TOKEN)).toBe(true);
    expect(upgradeAllowed(req("GET", { "x-ndx-token": TOKEN }), HUB_PORT, TOKEN)).toBe(true);
    expect(upgradeAllowed(req("GET", { origin: "http://localhost:3117" }), HUB_PORT, null)).toBe(true);
  });
});

describe("upgradeAllowed", () => {
  it("refuses a WebSocket handshake from another origin, and allows the dashboard's", () => {
    // A handshake carries no preflight, so this is the only check there is:
    // otherwise any open page could read every frame a project broadcasts.
    expect(upgradeAllowed(req("GET", { origin: "http://evil.test" }), HUB_PORT)).toBe(false);
    expect(upgradeAllowed(req("GET", { origin: "http://localhost:3117" }), HUB_PORT)).toBe(true);
    expect(upgradeAllowed(req("GET"), HUB_PORT)).toBe(true);
  });

  it("refuses a handshake whose Host is not the hub, whatever its Origin", () => {
    expect(upgradeAllowed(req("GET", { host: "attacker.example:3117" }), HUB_PORT)).toBe(false);
    expect(
      upgradeAllowed(req("GET", { host: "attacker.example:3117", origin: "http://localhost:3117" }), HUB_PORT),
    ).toBe(false);
  });
});
