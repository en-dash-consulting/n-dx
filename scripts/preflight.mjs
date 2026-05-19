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
 */

import { spawnTool } from "../packages/llm-client/dist/public.js";

const steps = [
  { name: "obfuscated-code", cmd: "pnpm security:obfuscation" },
  { name: "build",     cmd: "pnpm build" },
  { name: "typecheck", cmd: "pnpm typecheck" },
  { name: "docs",      cmd: "pnpm docs:build" },
  { name: "pr-check",  cmd: "pnpm pr-check" },
  { name: "test",      cmd: "pnpm test" },
];

let failed = false;

for (const { name, cmd } of steps) {
  process.stdout.write(`\n── ${name} ──\n`);
  try {
    const [tool, ...args] = cmd.split(" ");
    const result = await spawnTool(tool, args, {
      cwd: process.cwd(),
      stdio: "inherit",
      timeout: 600_000,
    });
    if (result.exitCode !== 0) {
      throw new Error(`${cmd} exited with code ${result.exitCode}`);
    }
    console.log(`  ✓ ${name}`);
  } catch {
    console.error(`  ✗ ${name} FAILED`);
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

console.log(failed ? "\nPreflight FAILED" : "\nPreflight passed ✓");
process.exit(failed ? 1 : 0);
