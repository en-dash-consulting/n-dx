#!/usr/bin/env node

/**
 * Local CI preflight — mirrors every step in .github/workflows/ci.yml.
 *
 * Run before pushing to catch issues that would fail in CI:
 *   pnpm preflight
 *
 * Steps (in order):
 *   1. pnpm security:obfuscation
 *   2. pnpm build
 *   3. pnpm typecheck
 *   4. pnpm docs:build
 *   5. pnpm pr-check
 *   6. pnpm test
 *   7. changeset presence check
 *
 * Each step is timed and a `── timing ──` summary prints at the end, in run
 * order, with each step's share of the wall clock. The question it exists to
 * answer is "which step is the four minutes?" — asked once too often from a
 * transcript that showed only the total, and unanswerable after the fact
 * because the steps stream their output and scroll away. The summary prints on
 * failure too, covering the steps that did run.
 */

import { spawnCli } from "../packages/llm-client/dist/public.js";

/** Per-step timeout. */
const STEP_TIMEOUT_MS = 600_000;

/** Grace period before escalating SIGTERM → SIGKILL on timeout. */
const KILL_ESCALATION_MS = 5_000;

/**
 * `1m 04s` past a minute, `4.3s` below it, `540ms` below a second.
 *
 * Minutes and seconds rather than raw seconds because the steps that matter
 * here run in minutes, and "247.31s" is a number the reader has to divide.
 */
function formatDuration(ms) {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1_000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(Math.round(seconds - minutes * 60)).padStart(2, "0")}s`;
}

/**
 * Run one preflight step, inheriting stdio so the child's output streams live.
 *
 * Uses `spawnCli` rather than `spawnTool`: `spawnTool` calls `spawn()` directly,
 * which on Windows cannot launch the `pnpm.CMD` shim — the child emits an
 * `error` event that surfaced as a bare `exitCode: 1` with no output at all.
 * `spawnCli` routes through cmd.exe on win32 and does a plain `spawn` on
 * macOS/Linux, where `pnpm` is a real executable on PATH.
 *
 * Resolves with the exit code (null when killed by the timeout).
 */
function runStep(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawnCli(cmd, args, { cwd: process.cwd(), stdio: "inherit" });

    let settled = false;
    let killTimer;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_ESCALATION_MS);
      if (!settled) {
        settled = true;
        reject(new Error(`timed out after ${STEP_TIMEOUT_MS / 1000}s`));
      }
    }, STEP_TIMEOUT_MS);

    const finish = (fn, value) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (settled) return;
      settled = true;
      fn(value);
    };

    // On win32 the child is cmd.exe, which spawns fine even when the target
    // binary is missing — that surfaces as a non-zero exit, not an error event.
    child.on("error", (err) => finish(reject, err));
    child.on("close", (code) => finish(resolve, code));
  });
}

const steps = [
  { name: "obfuscated-code", cmd: "pnpm security:obfuscation" },
  { name: "build",     cmd: "pnpm build" },
  { name: "typecheck", cmd: "pnpm typecheck" },
  { name: "docs",      cmd: "pnpm docs:build" },
  { name: "pr-check",  cmd: "pnpm pr-check" },
  { name: "test",      cmd: "pnpm test" },
];

let failed = false;

/** One `{ name, ms, ok }` per step that ran, in run order. */
const timings = [];
const startedAt = Date.now();

for (const { name, cmd } of steps) {
  process.stdout.write(`\n── ${name} ──\n`);
  const stepStartedAt = Date.now();
  try {
    const [tool, ...args] = cmd.split(" ");
    const exitCode = await runStep(tool, args);
    if (exitCode !== 0) {
      throw new Error(`${cmd} exited with code ${exitCode}`);
    }
    timings.push({ name, ms: Date.now() - stepStartedAt, ok: true });
    console.log(`  ✓ ${name} (${formatDuration(Date.now() - stepStartedAt)})`);
  } catch (err) {
    // A failed step's duration is worth as much as a passing one's — a
    // typecheck that fails in 4s and one that fails after a 9m timeout are
    // different problems.
    timings.push({ name, ms: Date.now() - stepStartedAt, ok: false });
    // Surface the reason — a swallowed message here made a spawn failure look
    // identical to a genuine step failure.
    console.error(`  ✗ ${name} FAILED — ${err?.message ?? err} (${formatDuration(Date.now() - stepStartedAt)})`);
    failed = true;
    break;
  }
}

// Changeset check (same logic as CI)
if (!failed) {
  process.stdout.write("\n── changeset ──\n");
  const { readdirSync } = await import("fs");
  const files = readdirSync(".changeset").filter(
    (f) => f.endsWith(".md") && f !== "README.md",
  );
  if (files.length === 0) {
    console.error("  ✗ No changeset found. Run: pnpm changeset");
    failed = true;
  } else {
    console.log(`  ✓ changeset (${files.join(", ")})`);
  }
}

if (timings.length > 0) {
  const totalMs = Date.now() - startedAt;
  process.stdout.write("\n── timing ──\n");
  for (const { name, ms, ok } of timings) {
    const share = totalMs > 0 ? `${Math.round((ms / totalMs) * 100)}%` : "";
    console.log(
      `  ${ok ? " " : "✗"} ${name.padEnd(16)}${formatDuration(ms).padStart(8)}${share.padStart(6)}`,
    );
  }
  // Wall clock, so the shares above account for everything the run spent,
  // including the changeset check and this script's own overhead.
  console.log(`    ${"total".padEnd(16)}${formatDuration(totalMs).padStart(8)}`);
}

console.log(failed ? "\nPreflight FAILED" : "\nPreflight passed ✓");
process.exit(failed ? 1 : 0);
