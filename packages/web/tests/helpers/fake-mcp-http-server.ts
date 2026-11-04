/**
 * An in-process fake MCP server over streamable HTTP for the connection tests,
 * stateless (a fresh server per request) and bound to 127.0.0.1. Records each
 * request's Authorization header and each tool call, so a test can assert what
 * was sent and whether a call reached the server at all.
 */

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createFakeMcpServer } from "../fixtures/connections/fake-mcp-tools.mjs";

export interface FakeMcpHttpServer {
  url: string;
  /** Authorization header of every request, in order (undefined when absent). */
  authorizations: Array<string | undefined>;
  /** Every tools/call the server received, in order. */
  calls: Array<{ name: string; arguments: Record<string, unknown> }>;
  /** Answer 401 to every request while set. */
  requireToken?: string;
  close(): Promise<void>;
}

export async function startFakeMcpHttpServer(): Promise<FakeMcpHttpServer> {
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
    fake.authorizations.push(req.headers.authorization);
    if (fake.requireToken && req.headers.authorization !== `Bearer ${fake.requireToken}`) {
      res.writeHead(401).end();
      return;
    }
    const body = req.method === "POST" ? JSON.parse(await readAll(req)) as unknown : undefined;
    for (const message of Array.isArray(body) ? body : [body]) {
      const { method, params } = (message ?? {}) as { method?: string; params?: { name: string; arguments?: Record<string, unknown> } };
      if (method === "tools/call" && params) fake.calls.push({ name: params.name, arguments: params.arguments ?? {} });
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

async function readAll(req: IncomingMessage): Promise<string> {
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
