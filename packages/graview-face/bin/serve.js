#!/usr/bin/env node
/**
 * `ndx-graview-face [--port <n>]`: this product's dev server, from wherever
 * the package is installed, and the sidecar its `ndx.extension` block
 * declares. `ndx graview serve .` runs it from the launch plan
 * `ndx extensions sidecar graview-face` prints, with the projection and the
 * rex endpoint added to the environment (NDX_GRAVIEW_DIR, NDX_REX_MCP_URL,
 * NDX_TOKEN_FILE, NDX_PROJECT_ROOT, NDX_GRAVIEW_CLI); run by hand, it serves
 * whatever `pnpm sync` last copied into public/data, read-only.
 *
 * The port is `--port`, else `PORT`, else 5188. Only the hub's `PORT`, which
 * arrives with `NDX_EXTENSION_NAME`, mounts the page at `/x/<name>/`.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`ndx-graview-face [--port <n>]

  Serves n-dx's face on Graview at the root, on --port, else PORT, else 5188.
  Under \`ndx graview serve .\` the projection and the rex endpoint arrive in
  the environment; by hand it serves public/data (see \`pnpm sync\`), read-only.
  Started by the hub (PORT with NDX_EXTENSION_NAME), it serves under /x/<name>/.`);
  process.exit(0);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const portFlag = args.findIndex((a) => a === "--port" || a.startsWith("--port="));
const portText = portFlag === -1 ? process.env.PORT || "5188" : (args[portFlag].includes("=") ? args[portFlag].split("=")[1] : args[portFlag + 1]) ?? "";
const port = Number(portText);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`ndx-graview-face: --port needs a port number (got ${JSON.stringify(portText)})`);
  process.exit(2);
}

// The hub adds `PORT` to the extension environment, so `PORT` with `NDX_EXTENSION_NAME`
// is the hub; an ambient `PORT` alone is not. The hub probes 127.0.0.1 (where `localhost`
// may be ::1) and serves us at `/x/<name>/`, so the page asks for everything under that
// mount (dev/hub-mount.ts puts back the prefix the hub strips). By hand, or with --port
// as `ndx graview serve` passes it, the root.
const hubbed = portFlag === -1 && Boolean(process.env.PORT) && Boolean(process.env.NDX_EXTENSION_NAME);
const base = hubbed ? `/x/${process.env.NDX_EXTENSION_NAME}/` : "/";

// Vite is loaded only once the arguments say we are serving: `--help` answers without it.
const { createServer } = await import("vite");
const server = await createServer({ root, base, configFile: resolve(root, "vite.config.ts"), server: { port, strictPort: true, host: hubbed ? "127.0.0.1" : "localhost" } });
await server.listen();
server.printUrls();
