import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>,
) => boolean | Promise<boolean>;

/**
 * Loopback host used for both binding and fetching.
 *
 * Explicit `127.0.0.1` rather than `localhost`: on dual-stack machines
 * `localhost` may resolve to `::1` while the server listens on IPv4 (or vice
 * versa), which makes requests land somewhere other than the server under
 * test. Pinning both ends to the same literal removes that ambiguity.
 */
export const TEST_HOST = "127.0.0.1";

export interface RouteTestServer {
  server: Server;
  port: number;
  /** `http://127.0.0.1:<port>` — prefer this over hand-built URLs. */
  baseUrl: string;
  /**
   * Close the server and wait until it has actually stopped listening.
   *
   * `server.close()` is asynchronous: it stops accepting new connections but
   * resolves only once existing sockets drain. Returning before that lets the
   * OS hand the just-freed ephemeral port to another listener (including test
   * servers in other packages during a full `pnpm -r test` run) while a
   * request is still in flight — the flake where a route test received a
   * response no code path in that route group can produce (a 401 or a
   * 200 where 404 was expected).
   */
  close: () => Promise<void>;
}

/**
 * Close a route test server and wait until the port is released.
 *
 * For call sites that kept only the `server` handle. Prefer the `close()`
 * returned by {@link startRouteTestServer}.
 */
export function closeRouteTestServer(server: Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((err?: Error) => {
      if (err && (err as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") {
        reject(err);
        return;
      }
      resolve();
    });
    // Start shutdown first, then drop lingering keep-alive sockets. Calling
    // closeAllConnections before close can leave Node waiting for handles that
    // were removed before the close sequence was registered.
    server.closeAllConnections?.();
    server.closeIdleConnections?.();
  });
}

export function startRouteTestServer(
  handleRoute: RouteHandler,
): Promise<RouteTestServer> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (await handleRoute(req, res)) {
        return;
      }
      res.writeHead(404);
      res.end("Not found");
    });

    server.listen(0, TEST_HOST, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        server,
        port,
        baseUrl: `http://${TEST_HOST}:${port}`,
        close: () => closeRouteTestServer(server),
      });
    });
  });
}
