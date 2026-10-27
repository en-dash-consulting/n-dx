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
 * The port is `--port`, else `PORT` (what the hub hands a sidecar), else 5188.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`ndx-graview-face [--port <n>]

  Serves n-dx's face on Graview (default port 5188). Under \`ndx graview serve .\`
  the projection and the rex endpoint arrive in the environment; by hand it
  serves public/data (see \`pnpm sync\`), read-only.`);
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

// Vite is loaded only once the arguments say we are serving: `--help` answers without it.
const { createServer } = await import("vite");
const server = await createServer({ root, configFile: resolve(root, "vite.config.ts"), server: { port, strictPort: true, host: "localhost" } });
await server.listen();
server.printUrls();
