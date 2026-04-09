import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>,
) => boolean | Promise<boolean>;

export function startRouteTestServer(
  handleRoute: RouteHandler,
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (await handleRoute(req, res)) {
        return;
      }
      res.writeHead(404);
      res.end("Not found");
    });

    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}
