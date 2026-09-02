#!/usr/bin/env node
// Thin wrapper — delegates to the hench CLI via the same resolution logic as cli.js
import { createRequire } from "module";
import { existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import {
  createChildProcessTracker,
  installTrackedChildProcessHandlers,
  treeKillSpawnOptions,
} from "../child-lifecycle.js";
import { suppressKnownDeprecations } from "@n-dx/llm-client";

suppressKnownDeprecations();

const MONOREPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const _require = createRequire(import.meta.url);

let script = join(MONOREPO_ROOT, "packages/hench/dist/cli/index.js");
if (!existsSync(script)) {
  try { script = _require.resolve("@n-dx/hench/dist/cli/index.js"); } catch {}
}

// treeKill: true (plus spawning with treeKillSpawnOptions() below) so a
// SIGTERM/SIGINT reaches this process's ENTIRE tree — not just the inner
// hench CLI, but the claude/codex CLI child it spawns in turn. Without this,
// a caller that signals this wrapper (e.g. the web dashboard's task Stop
// button) can kill the wrapper while an in-flight LLM CLI child is orphaned
// and keeps running.
const tracker = createChildProcessTracker({ treeKill: true });
const signalHandlers = installTrackedChildProcessHandlers({
  tracker,
  signals: ["SIGINT", "SIGTERM", "SIGHUP"],
});
const child = tracker.register(spawn(process.execPath, [script, ...process.argv.slice(2)], {
  ...treeKillSpawnOptions(),
  stdio: "inherit",
}));

child.on("close", async (code) => {
  signalHandlers.dispose();
  await tracker.cleanup();
  process.exit(code ?? 1);
});
