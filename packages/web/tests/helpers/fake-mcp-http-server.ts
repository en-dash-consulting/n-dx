/**
 * An in-process fake MCP server over streamable HTTP for the connection tests,
 * stateless (a fresh server per request) and bound to 127.0.0.1. Records each
 * request's Authorization header and each tool call, so a test can assert what
 * was sent and whether a call reached the server at all.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createFakeMcpServer } from "../fixtures/connections/fake-mcp-tools.mjs";

export interface FakeMcpHttpServer {
  url: string;
  /** Authorization header of every request, in order (undefined when absent). */
  authorizations: Array<string | undefined>;
  /** Every tools/call the server received, in order. */
  calls: Array<{ name: string; arguments: Record<string, unknown> }>;
  /** Accept every request and never answer it while set; `authorizations` still counts them. */
  silent?: boolean;
  /** Answer 401 to every request while set. */
  requireToken?: string;
  /**
   * Answer 500 with a body echoing the request's Authorization header, to
   * every request ("all") or only to tools/call ("calls"), like a server that
   * dumps its request on an error.
   */
  echoErrors?: "all" | "calls";
  close(): Promise<void>;
}

export interface FakeMcpHttpServerOptions {
  /**
   * Answers a request before the MCP endpoint sees it (an authorization
   * server's routes, a bearer check); returns true when it did. Requests it
   * answers are not recorded in `authorizations`.
   */
  route?: (req: IncomingMessage, res: ServerResponse) => boolean | Promise<boolean>;
}

export async function startFakeMcpHttpServer(options: FakeMcpHttpServerOptions = {}): Promise<FakeMcpHttpServer> {
  const fake: FakeMcpHttpServer = {
    url: "",
    authorizations: [],
    calls: [],
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
  const server: Server = createServer(async (req, res) => {
    if (options.route && (await options.route(req, res))) return;
    fake.authorizations.push(req.headers.authorization);
    if (fake.silent) return;
    if (fake.requireToken && req.headers.authorization !== `Bearer ${fake.requireToken}`) {
      res.writeHead(401).end();
      return;
    }
    const echoError = () => res.writeHead(500, { "content-type": "text/plain" }).end(`upstream failure on ${req.url}; request headers: authorization: ${req.headers.authorization}`);
    if (fake.echoErrors === "all") {
      echoError();
      return;
    }
    const body = req.method === "POST" ? JSON.parse(await readAll(req)) as unknown : undefined;
    let isCall = false;
    for (const message of Array.isArray(body) ? body : [body]) {
      const { method, params } = (message ?? {}) as { method?: string; params?: { name: string; arguments?: Record<string, unknown> } };
      if (method === "tools/call" && params) {
        isCall = true;
        fake.calls.push({ name: params.name, arguments: params.arguments ?? {} });
      }
    }
    if (isCall && fake.echoErrors === "calls") {
      echoError();
      return;
    }
    const mcp = createFakeMcpServer("fake-http");
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  return fake;
}

export async function readAll(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

/** A server that accepts connections and never answers, for timeouts. */
export async function startSilentHttpServer(): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer(() => undefined);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
