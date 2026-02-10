#!/usr/bin/env node

/**
 * n-dx web dashboard CLI
 *
 * Commands:
 *   serve [dir]   - Start the web dashboard server
 */

import { resolve } from "node:path";
import { startServer } from "../server/start.js";

const args = process.argv.slice(2);
const command = args[0];

let port = 3117;

for (const a of args.slice(1)) {
  if (a.startsWith("--port=")) {
    port = parseInt(a.split("=")[1], 10);
  }
}

const targetArg = args.slice(1).find((a) => !a.startsWith("-"));

if (command === "serve") {
  const dir = resolve(targetArg || ".");
  const dev = args.includes("--dev");
  startServer(dir, port, { dev });
} else {
  console.log(`n-dx web dashboard

Commands:
  serve [dir]   Start the web dashboard server

Options:
  --port=N      Port to listen on (default: 3117)
  --dev         Enable dev mode (live reload)
`);
  if (command) {
    console.error(`Unknown command: ${command}`);
    process.exit(1);
  }
}
