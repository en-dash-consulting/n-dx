import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { handleRequestSecurity } from "../../src/server/request-security.js";

interface MockResponse {
  response: ServerResponse;
  headers: Map<string, string>;
  status: () => number | undefined;
  body: () => string | undefined;
}

function makeRequest(
  method: string,
  headers: Record<string, string> = {},
  localPort = 3117,
): IncomingMessage {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return {
    method,
    headers: normalized,
    socket: { localPort },
  } as unknown as IncomingMessage;
}

function makeResponse(): MockResponse {
  const headers = new Map<string, string>();
  let statusCode: number | undefined;
  let responseBody: string | undefined;

  const response = {
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name.toLowerCase(), String(value));
      return this;
    },
    writeHead(code: number, values?: Record<string, string>) {
      statusCode = code;
      for (const [name, value] of Object.entries(values ?? {})) {
        headers.set(name.toLowerCase(), value);
      }
      return this;
    },
    end(body?: string) {
      responseBody = body;
      return this;
    },
  } as unknown as ServerResponse;

  return {
    response,
    headers,
    status: () => statusCode,
    body: () => responseBody,
  };
}

describe("HTTP request origin protection", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "rejects a cross-origin %s before route dispatch",
    (method) => {
      const req = makeRequest(method, {
        "Content-Type": "text/plain",
        Origin: "https://attacker.example",
      });
      const res = makeResponse();
      let mutations = 0;

      if (!handleRequestSecurity(req, res.response)) mutations += 1;

      expect(res.status()).toBe(403);
      expect(res.headers.get("access-control-allow-origin")).toBeUndefined();
      expect(JSON.parse(res.body() ?? "{}")).toEqual({ error: "Cross-origin request rejected" });
      expect(mutations).toBe(0);
    },
  );

  it("rejects cross-site browser mutations even when Origin is absent", () => {
    const req = makeRequest("POST", { "Sec-Fetch-Site": "cross-site" });
    const res = makeResponse();

    expect(handleRequestSecurity(req, res.response)).toBe(true);
    expect(res.status()).toBe(403);
  });

  it("rejects an untrusted CORS preflight without advertising CORS access", () => {
    const req = makeRequest("OPTIONS", {
      Origin: "https://attacker.example",
      "Access-Control-Request-Method": "POST",
    });
    const res = makeResponse();

    expect(handleRequestSecurity(req, res.response)).toBe(true);
    expect(res.status()).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeUndefined();
  });

  it("allows a loopback-origin preflight on the server's actual port", () => {
    const origin = "http://localhost:3117";
    const req = makeRequest("OPTIONS", {
      Origin: origin,
      "Access-Control-Request-Method": "PUT",
      "Access-Control-Request-Headers": "Content-Type, Mcp-Session-Id",
    });
    const res = makeResponse();

    expect(handleRequestSecurity(req, res.response)).toBe(true);
    expect(res.status()).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    expect(res.headers.get("vary")).toContain("Origin");
    expect(res.headers.get("access-control-allow-methods")).toContain("PUT");
    expect(res.headers.get("access-control-allow-headers")).toContain("Mcp-Session-Id");
    expect(res.headers.get("access-control-expose-headers")).toContain("Mcp-Session-Id");
  });

  it("allows loopback-origin and non-browser mutations", () => {
    const browserReq = makeRequest("POST", { Origin: "http://127.0.0.1:3117" });
    const browserRes = makeResponse();
    const cliReq = makeRequest("POST");
    const cliRes = makeResponse();

    expect(handleRequestSecurity(browserReq, browserRes.response)).toBe(false);
    expect(browserRes.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:3117");
    expect(handleRequestSecurity(cliReq, cliRes.response)).toBe(false);
    expect(cliRes.headers.get("access-control-allow-origin")).toBeUndefined();
  });

  it("requires the Origin port to match the listening socket", () => {
    const req = makeRequest("POST", { Origin: "http://localhost:9000" });
    const res = makeResponse();

    expect(handleRequestSecurity(req, res.response)).toBe(true);
    expect(res.status()).toBe(403);
  });

  it("does not trust a non-loopback Origin even if it could match Host", () => {
    const req = makeRequest("POST", {
      Host: "attacker.example:3117",
      Origin: "http://attacker.example:3117",
    });
    const res = makeResponse();

    expect(handleRequestSecurity(req, res.response)).toBe(true);
    expect(res.status()).toBe(403);
  });
});
