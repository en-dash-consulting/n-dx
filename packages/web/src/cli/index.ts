#!/usr/bin/env node

/**
 * n-dx web dashboard CLI
 *
 * Commands:
 *   serve [dir]   - Start the web dashboard server
 */

import { resolve } from "node:path";
import { suppressKnownDeprecations } from "@n-dx/llm-client";
import { startServer } from "../server/start.js";
import type { ViewerScope } from "../shared/view-routing.js";

suppressKnownDeprecations();

const VALID_SCOPES = new Set<ViewerScope>(["sourcevision", "rex", "hench"]);

const args = process.argv.slice(2);
const command = args[0];

let port = 3117;
let scope: ViewerScope | undefined;

for (const a of args.slice(1)) {
  if (a.startsWith("--port=")) {
    port = parseInt(a.split("=")[1], 10);
  } else if (a.startsWith("--scope=")) {
    const val = a.split("=")[1] as ViewerScope;
    if (!VALID_SCOPES.has(val)) {
      console.error(`Invalid scope: ${val} (valid: ${[...VALID_SCOPES].join(", ")})`);
      process.exit(1);
    }
    scope = val;
  }
}

const targetArg = args.slice(1).find((a) => !a.startsWith("-"));

if (command === "serve") {
  const dir = resolve(targetArg || ".");
  const dev = args.includes("--dev");
  await startServer(dir, port, { dev, scope });
} else {
  console.log(`n-dx web dashboard

Commands:
  serve [dir]   Start the web dashboard server

Options:
  --port=N                  Port to listen on (default: 3117)
  --scope=<package>         Restrict to a single package (sourcevision, rex, hench)
  --dev                     Enable dev mode (live reload)
`);
  if (command) {
    console.error(`Unknown command: ${command}`);
    process.exit(1);
  }
}
