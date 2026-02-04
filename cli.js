#!/usr/bin/env node

import { spawn } from "child_process";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

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

const [command, ...rest] = process.argv.slice(2);

// --- Orchestration commands ---

if (command === "init") {
  const dir = resolveDir(rest);
  await runOrDie(tools.sourcevision, ["init", dir]);
  await runOrDie(tools.rex, ["init", dir]);
  await runOrDie(tools.hench, ["init", dir]);
  process.exit(0);
}

if (command === "plan") {
  const dir = resolveDir(rest);
  const flags = extractFlags(rest);
  const hasFile = flags.some((f) => f.startsWith("--file=") || f === "--file");

  // Skip sourcevision when importing from a specific file
  if (!hasFile) {
    await runOrDie(tools.sourcevision, ["analyze", dir]);
  }

  await runOrDie(tools.rex, ["analyze", ...flags, dir]);
  process.exit(0);
}

if (command === "work") {
  const dir = resolveDir(rest);
  const flags = extractFlags(rest);
  await runOrDie(tools.hench, ["run", ...flags, dir]);
  process.exit(0);
}

if (command === "status") {
  const dir = resolveDir(rest);
  const flags = extractFlags(rest);
  await runOrDie(tools.rex, ["status", ...flags, dir]);
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
  plan [dir]            Analyze codebase and show PRD proposals
  plan --accept [dir]   Analyze and accept proposals into PRD
  work [dir]            Run next task (--task=ID, --auto, --iterations=N)
  status [dir]          Show PRD status (--format=json)

Tools:
  rex ...               PRD management and task tracking
  hench ...             Autonomous agent for task execution
  sourcevision ...      Codebase analysis and visualization
  sv ...                Alias for sourcevision

Usage: n-dx <command> [args...]`);
process.exit(command ? 1 : 0);
