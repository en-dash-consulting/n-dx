/**
 * THE FACE UNDER THE HUB. The hub serves a sidecar at `/x/<name>/` and
 * forwards each request with that prefix stripped; the page, though, must ask
 * for everything under the mount, so `bin/serve.js` sets Vite's `base` to it.
 * This plugin puts the prefix back on what arrives, HTTP and the HMR
 * WebSocket alike, so Vite and the door see the paths the page asked for.
 * A request already under the mount (the sidecar's printed URL, Vite's
 * direct HMR fallback) is left as it is. At the root (`base` is `/`, as
 * under `ndx graview serve .`) it does nothing.
 */
import type { IncomingMessage } from "node:http";
import type { Plugin } from "vite";

/** `url` as the hub forwarded it (`/a?b`), back under the mount `base` (`/x/name/`); unchanged when already under it. */
export function underMount(base: string, url: string): string {
  const bare = base.slice(0, -1);
  if (url.startsWith(base) || url === bare || url.startsWith(`${bare}?`) || url.startsWith(`${bare}#`)) return url;
  return base + (url.startsWith("/") ? url.slice(1) : url);
}

export function hubMount(): Plugin {
  return {
    name: "ndx-hub-mount",
    configureServer(server) {
      const base = server.config.base;
      if (base === "/") return;
      const secret = process.env["NDX_SIDECAR_SECRET"];
      if (!secret) throw new Error("The hub must provide NDX_SIDECAR_SECRET");
      const admitted = (req: IncomingMessage) => req.headers["x-ndx-sidecar-secret"] === secret;
      const restore = (req: IncomingMessage) => {
        req.url = underMount(base, req.url ?? "/");
      };
      // Before Vite's own listener, which matches the HMR socket's path against the base.
      server.httpServer?.prependListener("upgrade", (req, socket) => {
        if (!admitted(req)) { socket.destroy(); return; }
        restore(req);
      });
      server.middlewares.use((req, res, next) => {
        if (!admitted(req)) { res.writeHead(403).end("Forbidden"); return; }
        restore(req);
        next();
      });
    },
  };
}
