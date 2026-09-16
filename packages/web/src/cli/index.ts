#!/usr/bin/env node

/**
 * n-dx web dashboard CLI
 *
 * Commands:
 *   serve [dir]   - Start the web dashboard server
 *   hub           - Start the machine-wide hub (registry + one server per repo)
 */

import { resolve } from "node:path";
import { suppressKnownDeprecations, setVerbose, setDebug } from "@n-dx/llm-client";
import { startServer } from "../server/start.js";
import { startHub, DEFAULT_HUB_PORT } from "../hub/index.js";
import type { ViewerScope } from "../shared/view-routing.js";

suppressKnownDeprecations();

const VALID_SCOPES = new Set<ViewerScope>(["sourcevision", "rex", "hench"]);

const args = process.argv.slice(2);
const command = args[0];

let port = DEFAULT_HUB_PORT;
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

setVerbose(args.includes("--verbose"));
setDebug(args.includes("--debug"));

if (command === "serve") {
  // setDebug() above intentionally sets process.env.NDX_DEBUG so a one-shot
  // CLI invocation's own debug tracing propagates to whatever it spawns —
  // but "serve" is a long-running server, not a one-shot invocation. Left
  // in place, every rex/hench/sourcevision subprocess *any* dashboard
  // request spawns for the rest of this process's life would silently
  // inherit it. Individual command triggers pass --verbose/--debug
  // explicitly to the specific command they spawn when requested (see
  // routes-commands.ts), so undo the global env mutation here — this
  // process's own isVerbose()/isDebug() flags (for its heartbeat/error
  // output) are unaffected, since those read module-local state, not env.
  delete process.env.NDX_DEBUG;

  const dir = resolve(targetArg || ".");
  const dev = args.includes("--dev");
  await startServer(dir, port, { dev, scope });
} else if (command === "hub") {
  // Same reasoning as "serve": the hub is long-running and spawns a server
  // per project, all of which would otherwise inherit NDX_DEBUG.
  delete process.env.NDX_DEBUG;

  const hub = await startHub({ port, log: (message) => console.log(message) });
  console.log(`n-dx hub listening on http://127.0.0.1:${hub.port} (registry: ${hub.registryPath})`);

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[hub] ${signal} — stopping project servers`);
    hub.close({ stopChildren: true }).then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
} else {
  console.log(`n-dx web dashboard

Commands:
  serve [dir]   Start the web dashboard server
  hub           Start the machine-wide hub: project registry, one dashboard server per repository

Options:
  --port=N                  Port to listen on (default: 3117)
  --scope=<package>         Restrict to a single package (sourcevision, rex, hench)
  --dev                     Enable dev mode (live reload)
  --verbose                 Show periodic "still serving" heartbeat while running
  --debug                   Show verbose output plus stack traces on error
`);
  if (command) {
    console.error(`Unknown command: ${command}`);
    process.exit(1);
  }
}
