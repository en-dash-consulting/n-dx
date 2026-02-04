#!/usr/bin/env node

import { spawn } from "child_process";
import { existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { runConfig } from "./config.js";
import { runCI } from "./ci.js";

const __dir = dirname(fileURLToPath(import.meta.url));

// Catch unhandled errors at the top level — never show stack traces
process.on("uncaughtException", (err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
});

const tools = {
  rex: "packages/rex/dist/cli/index.js",
  hench: "packages/hench/dist/cli/index.js",
  sourcevision: "packages/sourcevision/dist/cli/index.js",
  sv: "packages/sourcevision/dist/cli/index.js",
};

function run(script, args) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [resolve(__dir, script), ...args], {
      stdio: "inherit",
    });
    child.on("close", (code) => res(code ?? 1));
  });
}

async function runOrDie(script, args) {
  const code = await run(script, args);
  if (code !== 0) process.exit(code);
}

function resolveDir(args) {
  for (let i = args.length - 1; i >= 0; i--) {
    if (!args[i].startsWith("-")) return args[i];
  }
  return process.cwd();
}

function extractFlags(args) {
  return args.filter((a) => a.startsWith("-"));
}

/**
 * Check that required directories exist before running orchestration commands.
 * Provides a clear, actionable error message suggesting `n-dx init`.
 */
function requireInit(dir, dirs) {
  const missing = dirs.filter((d) => !existsSync(join(dir, d)));
  if (missing.length > 0) {
    console.error(`Error: Missing ${missing.join(", ")} in ${dir}`);
    console.error(`Hint: Run 'n-dx init ${dir === process.cwd() ? "" : dir}' to set up the project.`.trimEnd());
    process.exit(1);
  }
}

const [command, ...rest] = process.argv.slice(2);

// --- Orchestration commands ---

if (command === "init") {
  const dir = resolveDir(rest);
  const flags = extractFlags(rest);
  await runOrDie(tools.sourcevision, ["init", ...flags, dir]);
  await runOrDie(tools.rex, ["init", ...flags, dir]);
  await runOrDie(tools.hench, ["init", ...flags, dir]);
  process.exit(0);
}

if (command === "plan") {
  const dir = resolveDir(rest);
  requireInit(dir, [".rex"]);
  const flags = extractFlags(rest);
  const hasFile = flags.some((f) => f.startsWith("--file=") || f === "--file");

  // Skip sourcevision when importing from a specific file
  if (!hasFile) {
    await runOrDie(tools.sourcevision, ["analyze", ...flags.filter((f) => f === "--quiet" || f === "-q"), dir]);
  }

  await runOrDie(tools.rex, ["analyze", ...flags, dir]);
  process.exit(0);
}

if (command === "work") {
  const dir = resolveDir(rest);
  requireInit(dir, [".rex", ".hench"]);
  const flags = extractFlags(rest);
  await runOrDie(tools.hench, ["run", ...flags, dir]);
  process.exit(0);
}

if (command === "status") {
  const dir = resolveDir(rest);
  requireInit(dir, [".rex"]);
  const flags = extractFlags(rest);
  await runOrDie(tools.rex, ["status", ...flags, dir]);
  process.exit(0);
}

if (command === "usage") {
  const dir = resolveDir(rest);
  requireInit(dir, [".rex"]);
  const flags = extractFlags(rest);
  await runOrDie(tools.rex, ["usage", ...flags, dir]);
  process.exit(0);
}

if (command === "sync") {
  const dir = resolveDir(rest);
  requireInit(dir, [".rex"]);
  const flags = extractFlags(rest);
  await runOrDie(tools.rex, ["sync", ...flags, dir]);
  process.exit(0);
}

if (command === "ci") {
  const dir = resolveDir(rest);
  requireInit(dir, [".rex", ".sourcevision"]);
  const flags = extractFlags(rest);
  try {
    const ok = await runCI(dir, flags, { run, tools });
    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

if (command === "config") {
  try {
    await runConfig(rest);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

// --- Delegation commands ---

if (tools[command]) {
  const code = await run(tools[command], rest);
  process.exit(code);
}

// --- Help ---

console.log(`n-dx — AI-powered development toolkit

Orchestration:
  init [dir]            Initialize all tools (sourcevision + rex + hench)
  plan [dir]            Analyze codebase and show PRD proposals (--guided for new projects)
  plan --accept [dir]   Analyze and accept proposals into PRD
  work [dir]            Run next task (--task=ID, --auto, --iterations=N)
  status [dir]          Show PRD status (--format=json, --since, --until)
  usage [dir]           Token usage analytics (--format=json, --group=day|week|month)
  sync [dir]            Sync local PRD with remote adapter (--push, --pull)
  ci [dir]              Run analysis pipeline and validate PRD health
  config [key] [value]  View and edit settings (--json, --help)

Tools:
  rex ...               PRD management and task tracking
  hench ...             Autonomous agent for task execution
  sourcevision ...      Codebase analysis and visualization
  sv ...                Alias for sourcevision

Global Options:
  --quiet, -q             Suppress informational output (for scripting)

Usage: n-dx <command> [args...]`);
process.exit(command ? 1 : 0);
