#!/usr/bin/env node
// Thin wrapper — delegates to the rex CLI via the same resolution logic as cli.js
import { createRequire } from "module";
import { existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import {
  createChildProcessTracker,
  installTrackedChildProcessHandlers,
} from "../child-lifecycle.js";

const MONOREPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const _require = createRequire(import.meta.url);

let script = join(MONOREPO_ROOT, "packages/rex/dist/cli/index.js");
if (!existsSync(script)) {
  try { script = _require.resolve("@n-dx/rex/dist/cli/index.js"); } catch {}
}

const tracker = createChildProcessTracker();
const signalHandlers = installTrackedChildProcessHandlers({
  tracker,
  signals: ["SIGINT", "SIGTERM", "SIGHUP"],
});
const child = tracker.register(spawn(process.execPath, [script, ...process.argv.slice(2)], { stdio: "inherit" }));

child.on("close", async (code) => {
  signalHandlers.dispose();
  await tracker.cleanup();
  process.exit(code ?? 1);
});
