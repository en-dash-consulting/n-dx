import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import { describe, expect, it } from "vitest";
import { handleRequestSecurity } from "../../src/server/request-security.js";
import { MAX_REQUEST_BODY_BYTES, errorResponse, readBody } from "../../src/server/response-utils.js";

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
    destroy: () => {},
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

describe("request body size limit", () => {
  it("rejects a request whose Content-Length exceeds the cap with 413", () => {
    const req = makeRequest("POST", {
      "content-length": String(MAX_REQUEST_BODY_BYTES + 1),
    });
    const res = makeResponse();

    expect(handleRequestSecurity(req, res.response)).toBe(true);
    expect(res.status()).toBe(413);
  });

  it("allows a request at exactly the cap", () => {
    const req = makeRequest("POST", {
      "content-length": String(MAX_REQUEST_BODY_BYTES),
    });
    const res = makeResponse();

    // Not handled by the size guard — falls through to normal processing.
    // (No Origin header, safe path → returns false so a route can run.)
    expect(handleRequestSecurity(req, res.response)).toBe(false);
    expect(res.status()).toBeUndefined();
  });

  it("ignores a missing or non-numeric Content-Length", () => {
    const cases: Record<string, string>[] = [{}, { "content-length": "not-a-number" }];
    for (const headers of cases) {
      const req = makeRequest("POST", headers);
      const res = makeResponse();
      expect(handleRequestSecurity(req, res.response)).toBe(false);
    }
  });
});

describe("request body size limit (integration)", () => {
  function startServer(): Promise<{ server: Server; port: number }> {
    return new Promise((resolve) => {
      const server = createServer((req, res) => {
        if (handleRequestSecurity(req, res)) return;
        res.writeHead(200);
        res.end("ok");
      });
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        resolve({ server, port });
      });
    });
  }

  it("answers 413 and closes the connection on an over-cap Content-Length", async () => {
    const { server, port } = await startServer();
    try {
      const { statusLine, closed } = await new Promise<{ statusLine: string; closed: boolean }>((resolve, reject) => {
        const socket = connect({ host: "127.0.0.1", port }, () => {
          // Declare an over-cap body but send only a sliver — the guard rejects
          // on the header alone, before the (never-sent) 10 MB would arrive.
          socket.write(
            `POST /api/anything HTTP/1.1\r\n` +
            `Host: 127.0.0.1:${port}\r\n` +
            `Content-Type: application/json\r\n` +
            `Content-Length: ${MAX_REQUEST_BODY_BYTES + 1}\r\n` +
            `\r\n` +
            `{`,
          );
        });
        let buf = "";
        let sawResponse = false;
        socket.on("data", (chunk: Buffer) => { buf += chunk.toString("utf-8"); if (buf.includes("\r\n")) sawResponse = true; });
        socket.on("close", () => resolve({ statusLine: buf.split("\r\n")[0], closed: sawResponse }));
        socket.on("error", reject);
        setTimeout(() => reject(new Error("timeout")), 3000);
      });
      expect(statusLine).toContain("413");
      expect(closed).toBe(true);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  /**
   * A route as they are all written: security guard, then `readBody(req, res)`
   * inside a try/catch that answers 400. The chunked body carries no
   * Content-Length, so the guard waves it through and the streamed cap in
   * readBody is the only thing between it and memory.
   */
  function startBodyReadingServer(): Promise<{ server: Server; port: number }> {
    return new Promise((resolve) => {
      const server = createServer(async (req, res) => {
        if (handleRequestSecurity(req, res)) return;
        try {
          const body = await readBody(req, res);
          res.writeHead(200);
          res.end(`read ${body.length}`);
        } catch (err) {
          // What every route does. Once readBody has answered 413 this is a
          // no-op, which is the point: no route had to change.
          errorResponse(res, 400, (err as Error).message);
        }
      });
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        resolve({ server, port });
      });
    });
  }

  it("answers 413 on an over-cap chunked body that declares no Content-Length", async () => {
    const { server, port } = await startBodyReadingServer();
    try {
      const { statusLine, body } = await new Promise<{ statusLine: string; body: string }>((resolve, reject) => {
        const socket = connect({ host: "127.0.0.1", port }, () => {
          socket.write(
            `POST /api/anything HTTP/1.1\r\n` +
            `Host: 127.0.0.1:${port}\r\n` +
            `Content-Type: application/json\r\n` +
            `Transfer-Encoding: chunked\r\n` +
            `\r\n`,
          );
          // Chunks until the cap is passed. Writing past it is the point: the
          // client keeps sending while the server decides.
          const chunk = "a".repeat(64 * 1024);
          const chunks = Math.ceil(MAX_REQUEST_BODY_BYTES / chunk.length) + 2;
          for (let i = 0; i < chunks; i++) {
            socket.write(`${chunk.length.toString(16)}\r\n${chunk}\r\n`);
          }
        });

        let buf = "";
        socket.on("data", (part: Buffer) => { buf += part.toString("utf-8"); });
        socket.on("close", () => resolve({ statusLine: buf.split("\r\n")[0], body: buf }));
        // A destroyed socket surfaces here as ECONNRESET/EPIPE — which is
        // exactly the bug: the client is entitled to a status line first.
        socket.on("error", (err) => { if (!buf) reject(err); else resolve({ statusLine: buf.split("\r\n")[0], body: buf }); });
        setTimeout(() => reject(new Error("timeout")), 5000);
      });

      expect(statusLine).toContain("413");
      // The same body the Content-Length guard sends, so a client cannot tell
      // which of the two refused it.
      expect(body).toContain(`Request body exceeds the ${MAX_REQUEST_BODY_BYTES}-byte limit.`);
      // And not the 400 the route's catch would have written.
      expect(statusLine).not.toContain("400");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 20_000);

  it("reads a chunked body under the cap normally", async () => {
    const { server, port } = await startBodyReadingServer();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/anything`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hello: "world" }),
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(`read ${JSON.stringify({ hello: "world" }).length}`);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 20_000);
});
