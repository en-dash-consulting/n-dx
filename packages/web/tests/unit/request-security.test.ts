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
  // Every real client sends Host. Default it to this socket so the origin
  // tests below exercise the origin rule, not the Host rule; the Host tests
  // override it explicitly.
  normalized.host ??= `127.0.0.1:${localPort}`;
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

describe("HTTP request Host validation", () => {
  it.each(["GET", "HEAD", "POST"])(
    "answers 421 to a %s whose Host is not loopback, before route dispatch",
    (method) => {
      const req = makeRequest(method, {
        Host: "attacker.example:3117",
        "Sec-Fetch-Site": "same-origin",
      });
      const res = makeResponse();

      expect(handleRequestSecurity(req, res.response)).toBe(true);
      expect(res.status()).toBe(421);
      expect(res.headers.get("access-control-allow-origin")).toBeUndefined();
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(JSON.parse(res.body() ?? "{}")).toEqual({ error: "Request Host does not name this server" });
    },
  );

  it.each(["localhost:3117", "127.0.0.1:3117", "[::1]:3117"])(
    "lets a GET through when Host is %s on the socket's own port",
    (host) => {
      const req = makeRequest("GET", { Host: host });
      const res = makeResponse();

      expect(handleRequestSecurity(req, res.response)).toBe(false);
      expect(res.status()).toBeUndefined();
    },
  );

  it("judges Host against the socket's port, not the port the client claims", () => {
    // The project server behind the hub listens on an ephemeral port; a Host
    // naming the hub's well-known port would be a request that never came
    // through the proxy (which rewrites Host to the child's port).
    const req = makeRequest("GET", { Host: "localhost:3117" }, 4242);
    const res = makeResponse();

    expect(handleRequestSecurity(req, res.response)).toBe(true);
    expect(res.status()).toBe(421);
  });

  it("refuses a request with no Host at all", () => {
    const req = makeRequest("GET");
    delete (req.headers as Record<string, unknown>).host;
    const res = makeResponse();

    expect(handleRequestSecurity(req, res.response)).toBe(true);
    expect(res.status()).toBe(421);
  });

  it("checks Host before Origin, so a trusted Origin cannot rescue a bad Host", () => {
    const req = makeRequest("POST", {
      Host: "attacker.example:3117",
      Origin: "http://127.0.0.1:3117",
    });
    const res = makeResponse();

    expect(handleRequestSecurity(req, res.response)).toBe(true);
    expect(res.status()).toBe(421);
    expect(res.headers.get("access-control-allow-origin")).toBeUndefined();
  });
});

describe("HTTP request token (per-user)", () => {
  const TOKEN = "tok_abcdefghijklmnopqrstuvwxyz0123456789";
  const opts = { token: TOKEN };

  it("does nothing when no token is configured", () => {
    const req = makeRequest("GET");
    const res = makeResponse();
    expect(handleRequestSecurity(req, res.response, {})).toBe(false);
    expect(handleRequestSecurity(req, res.response, { token: null })).toBe(false);
  });

  it("answers 401 with WWW-Authenticate to a request that presents nothing", () => {
    const req = makeRequest("GET");
    const res = makeResponse();
    expect(handleRequestSecurity(req, res.response, opts)).toBe(true);
    expect(res.status()).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Bearer");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(res.body() ?? "{}").error).toBe("Authentication required");
  });

  it.each<[string, Record<string, string>]>([
    ["bearer header", { Authorization: `Bearer ${TOKEN}` }],
    ["X-Ndx-Token header", { "X-Ndx-Token": TOKEN }],
    ["cookie", { Cookie: `theme=dark; ndx_token=${TOKEN}` }],
  ])("lets a request through that presents the token as a %s", (_label, headers) => {
    const req = makeRequest("POST", headers);
    const res = makeResponse();
    expect(handleRequestSecurity(req, res.response, opts)).toBe(false);
    expect(res.status()).toBeUndefined();
  });

  it("refuses a wrong token in every place", () => {
    const wrong: Array<Record<string, string>> = [
      { Authorization: `Bearer ${TOKEN}x` },
      { "X-Ndx-Token": TOKEN.slice(1) },
      { Cookie: "ndx_token=nope" },
      { Authorization: `Basic ${TOKEN}` },
    ];
    for (const headers of wrong) {
      const req = makeRequest("GET", headers);
      const res = makeResponse();
      expect(handleRequestSecurity(req, res.response, opts), JSON.stringify(headers)).toBe(true);
      expect(res.status(), JSON.stringify(headers)).toBe(401);
    }
  });

  it("turns a GET navigation carrying ?ndx_token= into a cookie and a redirect without it", () => {
    const req = makeRequest("GET");
    (req as { url?: string }).url = `/p/app/prd?view=tree&ndx_token=${TOKEN}`;
    const res = makeResponse();
    expect(handleRequestSecurity(req, res.response, opts)).toBe(true);
    expect(res.status()).toBe(302);
    expect(res.headers.get("location")).toBe("/p/app/prd?view=tree");
    expect(res.headers.get("set-cookie")).toContain(`ndx_token=${TOKEN}`);
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("sends the cookie redirect to the root when the request-target is scheme-relative", () => {
    // `GET //evil.com/?ndx_token=T` reaches req.url verbatim; the redirect
    // must stay on this origin even though the token itself was correct.
    const req = makeRequest("GET");
    (req as { url?: string }).url = `//evil.com/?ndx_token=${TOKEN}`;
    const res = makeResponse();
    expect(handleRequestSecurity(req, res.response, opts)).toBe(true);
    expect(res.status()).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    expect(res.headers.get("set-cookie")).toContain(`ndx_token=${TOKEN}`);
  });

  it("does not accept the query token on a mutation, or a wrong query token at all", () => {
    const post = makeRequest("POST");
    (post as { url?: string }).url = `/api/x?ndx_token=${TOKEN}`;
    const out = makeResponse();
    expect(handleRequestSecurity(post, out.response, opts)).toBe(true);
    expect(out.status()).toBe(401);

    const wrong = makeRequest("GET");
    (wrong as { url?: string }).url = `/?ndx_token=${TOKEN}x`;
    const out2 = makeResponse();
    expect(handleRequestSecurity(wrong, out2.response, opts)).toBe(true);
    expect(out2.status()).toBe(401);
  });

  it("still strips ?ndx_token= from a navigation the cookie already authenticates", () => {
    // The printed URL is reopened on every `ndx start`. Letting it through
    // unredirected left the token in the address bar and handed the static
    // route "/?ndx_token=…", which it did not match — a bare "Not found".
    const req = makeRequest("GET", { Cookie: `ndx_token=${TOKEN}` });
    (req as { url?: string }).url = `/?ndx_token=${TOKEN}`;
    const res = makeResponse();
    expect(handleRequestSecurity(req, res.response, opts)).toBe(true);
    expect(res.status()).toBe(302);
    expect(res.headers.get("location")).toBe("/");

    // A wrong query token on an authenticated request is ignored, not a 401.
    const stale = makeRequest("GET", { Cookie: `ndx_token=${TOKEN}` });
    (stale as { url?: string }).url = `/prd?ndx_token=${TOKEN}x`;
    const out = makeResponse();
    expect(handleRequestSecurity(stale, out.response, opts)).toBe(false);
  });

  it("checks Host before the token, so a valid token on a foreign Host is still 421", () => {
    const req = makeRequest("GET", { Host: "attacker.example:3117", Authorization: `Bearer ${TOKEN}` });
    const res = makeResponse();
    expect(handleRequestSecurity(req, res.response, opts)).toBe(true);
    expect(res.status()).toBe(421);
  });
});

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

  it("does not trust a non-loopback Origin on the right port even behind a loopback Host", () => {
    // The origin rule compares against the socket's port, never the Host
    // header, so a matching port on a foreign name buys nothing.
    const req = makeRequest("POST", {
      Host: "127.0.0.1:3117",
      Origin: "http://attacker.example:3117",
    });
    const res = makeResponse();

    expect(handleRequestSecurity(req, res.response)).toBe(true);
    expect(res.status()).toBe(403);

    // When Host matches that foreign Origin as well, the Host rule refuses first.
    const foreignHost = makeRequest("POST", {
      Host: "attacker.example:3117",
      Origin: "http://attacker.example:3117",
    });
    const out = makeResponse();
    expect(handleRequestSecurity(foreignHost, out.response)).toBe(true);
    expect(out.status()).toBe(421);
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
   *
   * `sent[i]` is every byte the server handed to connection i's socket, in
   * order. A test can then prove what the server answered before it closed
   * even when the client never got to read it (#523).
   */
  function startBodyReadingServer(): Promise<{ server: Server; port: number; sent: string[] }> {
    const sent: string[] = [];
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
      server.on("connection", (socket) => {
        const index = sent.push("") - 1;
        const write = socket.write.bind(socket) as (...args: unknown[]) => boolean;
        socket.write = ((...args: unknown[]) => {
          const data = args[0];
          sent[index] += typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf-8");
          return write(...args);
        }) as typeof socket.write;
      });
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        resolve({ server, port, sent });
      });
    });
  }

  /** Socket errors a client sees when the server hangs up while it is still sending. */
  const EARLY_CLOSE_CODES = ["EPIPE", "ECONNRESET", "ECONNABORTED"];

  it("answers 413 on an over-cap chunked body that declares no Content-Length", async () => {
    const { server, port, sent } = await startBodyReadingServer();
    const limitMessage = `Request body exceeds the ${MAX_REQUEST_BODY_BYTES}-byte limit.`;
    try {
      const client = await new Promise<{ received: string; abort?: string }>((resolve, reject) => {
        let received = "";
        let abort: string | undefined;
        const chunk = "a".repeat(64 * 1024);
        const frame = `${chunk.length.toString(16)}\r\n${chunk}\r\n`;
        // Enough chunks to pass the cap. Writing past it is the point: the
        // client keeps sending while the server decides.
        let remaining = Math.ceil(MAX_REQUEST_BODY_BYTES / chunk.length) + 2;
        // Honour backpressure and stop once the answer arrives, so the client
        // is not still racing a queued 10 MB into a socket the server closed.
        const pump = (): void => {
          while (remaining > 0 && !received && !socket.destroyed) {
            remaining--;
            if (!socket.write(frame)) {
              socket.once("drain", pump);
              return;
            }
          }
        };
        const socket = connect({ host: "127.0.0.1", port }, () => {
          socket.write(
            `POST /api/anything HTTP/1.1\r\n` +
            `Host: 127.0.0.1:${port}\r\n` +
            `Content-Type: application/json\r\n` +
            `Transfer-Encoding: chunked\r\n` +
            `\r\n`,
          );
          pump();
        });
        const timer = setTimeout(() => reject(new Error("timeout")), 5000);
        socket.on("data", (part: Buffer) => { received += part.toString("utf-8"); });
        // The server answers 413 and hangs up while the body is still coming.
        // A write or read that loses that race fails with EPIPE/ECONNRESET
        // (ECONNABORTED on Windows), possibly before the 413 is read (#523).
        // That is the expected close, not a failure: what the server sent is
        // checked from `sent` below.
        socket.on("error", (err: NodeJS.ErrnoException) => {
          if (err.code && EARLY_CLOSE_CODES.includes(err.code)) abort = err.code;
          else reject(err);
        });
        socket.on("close", () => {
          clearTimeout(timer);
          resolve({ received, abort });
        });
      });
      await new Promise<void>((r) => server.close(() => r()));

      // Deterministic whatever the client managed to read: the server wrote a
      // 413 before closing. A server that destroys the socket without
      // answering — the original readBody bug — leaves this empty.
      expect(sent).toHaveLength(1);
      expect(sent[0].split("\r\n")[0]).toContain("413");
      // The same body the Content-Length guard sends, so a client cannot tell
      // which of the two refused it — and not the 400 the route's catch writes.
      expect(sent[0]).toContain(limitMessage);
      expect(sent[0]).not.toContain(" 400 ");

      // Whatever reached the client is that same answer; nothing reached it
      // only when the connection was cut under it.
      if (client.received) {
        expect(client.received.split("\r\n")[0]).toContain("413");
        expect(client.received).toContain(limitMessage);
      } else {
        expect(EARLY_CLOSE_CODES).toContain(client.abort);
      }
    } finally {
      if (server.listening) await new Promise<void>((r) => server.close(() => r()));
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
