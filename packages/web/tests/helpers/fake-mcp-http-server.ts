/**
 * An in-process fake MCP server over streamable HTTP for the connection tests,
 * stateless (a fresh server per request) and bound to 127.0.0.1. Records each
 * request's Authorization header so a test can assert what was sent.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createFakeMcpServer } from "../fixtures/connections/fake-mcp-tools.mjs";

export interface FakeMcpHttpServer {
  url: string;
  /** Authorization header of every request, in order (undefined when absent). */
  authorizations: Array<string | undefined>;
  /** Answer 401 to every request while set. */
  requireToken?: string;
  close(): Promise<void>;
}

export async function startFakeMcpHttpServer(): Promise<FakeMcpHttpServer> {
  const fake: FakeMcpHttpServer = {
    url: "",
    authorizations: [],
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
    const mcp = createFakeMcpServer("fake-http");
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    await mcp.connect(transport);
    await transport.handleRequest(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  return fake;
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
