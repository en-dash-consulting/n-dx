#!/usr/bin/env node
/**
 * `ndx-graview-face [--port <n>]`: this product's dev server, from wherever
 * the package is installed. `ndx graview serve .` runs it with the
 * projection and the rex endpoint in the environment (NDX_GRAVIEW_DIR,
 * NDX_REX_MCP_URL, NDX_TOKEN_FILE, NDX_PROJECT_ROOT, NDX_GRAVIEW_CLI); run
 * by hand, it serves whatever `pnpm sync` last copied into public/data,
 * read-only.
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
const port = portFlag === -1 ? 5188 : Number((args[portFlag].includes("=") ? args[portFlag].split("=")[1] : args[portFlag + 1]) ?? 5188);

// Vite is loaded only once the arguments say we are serving: `--help` answers without it.
const { createServer } = await import("vite");
const server = await createServer({ root, configFile: resolve(root, "vite.config.ts"), server: { port, strictPort: true, host: "localhost" } });
await server.listen();
server.printUrls();
