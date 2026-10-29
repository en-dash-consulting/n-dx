---
id: "fc21d703-68d6-41e1-8db5-26e41b099441"
type: "task"
title: "One sanitized-environment builder for every repository-command subprocess: tests, gate, audit and rex"
slug: "one-sanitized-environment-builder-for"
description: "#686 finding 3 (high, must-fix):\n\n> In `packages/hench/src/tools/test-runner.ts`, `runPostTaskTests` (around line 390), `runTestGate` (around 969) and the audit steps (around 1519/1534) call `execShellCmd` with no `env`. `execShellCmd` (`packages/llm-client/src/exec.ts`) \"defaults to inheriting parent env\", so these subprocesses see ambient credentials that the shell and git guard would have stripped. The original review reproduced this: [a sentinel credential variable] appeared in a failing gate's output.\n>\n> **Fix:** thread the sanitized child environment (or a single safe-environment builder) through every subprocess caller: tests, gate, audit, and rex. Add an integration test that fails if a sentinel credential is visible to the test command.\n\nReproduced 2026-10-16 on the built origin/main: `execShellCmd` called the way the gate calls it shows a sentinel credential variable to the child. No caller sanitizes `process.env` first.\n\nCallers that run a repository-owned or repository-influenced command with no `env` today (re-check the list; it is the floor, not the ceiling):\n- hench `tools/test-runner.ts`: `runPostTaskTests`, `runTestGate`, the `pnpm audit` and `pnpm outdated` steps;\n- hench `tools/rex.ts` `createCommandExecutor` (requirement validation commands, which come from the PRD);\n- hench `tools/cleanup-transformations.ts` (`pnpm typecheck`);\n- rex `core/verify.ts` `execShell` (the `verify_criteria` test command).\n\nOne builder, not a fix per call site. The sanitizing primitives already exist in llm-client `child-env.ts` (`compileEnvPolicy`, `sanitizeChildEnv`), and hench's `GuardRails.childEnv` already applies them for the agent's shell tool. The builder lives in llm-client (foundation), so hench (through `prd/llm-gateway.ts`) and rex both reach it. It applies the project's `guard.env` policy, but a repository-supplied `guard.env.allow` is honoured only while the repository is trusted (see #625 and #656).\n\nEvery new or changed `child_process` caller keeps `packages/core/child-process-allowlist.json` and the shell-spawn inventory in step, in the same commit. Do not touch rex's migrations, the folder-tree parser, or the rex MCP tools get_capabilities and get_product: the v2 migrate stack owns them."
acceptanceCriteria:
  - "Closes #686 (finding 3)"
  - "One safe-environment builder in llm-client is used by every caller listed in the description: post-task tests, the test gate, the dependency audit, requirement validation commands, the cleanup typecheck, and rex's verify_criteria test command"
  - "A repository-supplied guard.env.allow entry reaches these children only while the repository is trusted"
  - "Integration test: with a sentinel credential variable in the parent environment, the test gate, post-task tests, the audit and the verify_criteria test command each run a command that reports whether the sentinel is visible, and every one reports it absent; the test fails on the code before the fix"
  - "Credential names and values never appear in test snapshots or log output; tests assert presence or absence only"
  - "packages/core/child-process-allowlist.json and the shell-spawn inventory stay in step with the change, and the six root policy tests pass"
priority: "high"
tags:
  - "security"
  - "issue-cleanup"
source: "ndx-capture"
---
