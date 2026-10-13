#!/usr/bin/env node
/**
 * `ndx-graview-face [--port <n>]`: this product's dev server, from wherever
 * the package is installed. `ndx graview serve .` runs it with the
 * projection and the rex endpoint in the environment (NDX_GRAVIEW_DIR,
 * NDX_REX_MCP_URL, NDX_TOKEN_FILE, NDX_PROJECT_ROOT, NDX_GRAVIEW_CLI); run
 * by hand, it serves whatever `pnpm sync` last copied into public/data,
 * read-only.
 *
 * Without `--port` it takes 5188 or, when another checkout's face holds that,
 * the next free port. Under `ndx graview serve` it records where it is in
 * `face.json` beside the projection, so the n-dx dashboard can link to it, and
 * removes the file when it stops.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`ndx-graview-face [--port <n>]

  Serves n-dx's face on Graview (port 5188, or the next free one; --port
  insists on its port). Under \`ndx graview serve .\`
  the projection and the rex endpoint arrive in the environment; by hand it
  serves public/data (see \`pnpm sync\`), read-only.`);
  process.exit(0);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const portFlag = args.findIndex((a) => a === "--port" || a.startsWith("--port="));
const portNamed = portFlag !== -1;
const portText = portFlag === -1 ? "5188" : (args[portFlag].includes("=") ? args[portFlag].split("=")[1] : args[portFlag + 1]) ?? "";
const port = Number(portText);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`ndx-graview-face: --port needs a port number (got ${JSON.stringify(portText)})`);
  process.exit(2);
}

// Vite is loaded only once the arguments say we are serving: `--help` answers without it.
const { createServer } = await import("vite");
const server = await createServer({ root, configFile: resolve(root, "vite.config.ts"), server: { port, strictPort: portNamed, host: "localhost" } });
await server.listen();
server.printUrls();

// Where this face is, for the dashboard's "Product map" link: only under `ndx graview serve`, which names the projection's dir.
const graviewDir = process.env.NDX_GRAVIEW_DIR;
const url = server.resolvedUrls?.local?.[0];
if (graviewDir && url) {
  const faceFile = resolve(graviewDir, "face.json");
  writeFileSync(faceFile, `${JSON.stringify({ url, pid: process.pid, startedAt: new Date().toISOString() }, null, 2)}\n`);
  const forget = () => {
    try {
      // Another face may have taken the file since; only this one's record is removed.
      if (JSON.parse(readFileSync(faceFile, "utf-8")).pid === process.pid) rmSync(faceFile, { force: true });
    } catch {
      /* already gone */
    }
  };
  process.on("exit", forget);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      forget();
      void server.close().finally(() => process.exit(0));
    });
  }
}
