---
id: "ab2081f7-57bc-4ef1-9f61-4772eadcce2a"
level: "task"
title: "Route remaining in-scope spawn sites: pair-programming.js and sourcevision rex spawns"
status: "pending"
priority: "medium"
tags:
  - "windows"
  - "core"
  - "sourcevision"
  - "gh:69"
  - "audit-remediation"
blockedBy:
  - "4cfcaad0-0e95-488c-950d-17c7f97c62b9"
source: "fable-audit-2026-07-10"
acceptanceCriteria:
  - "packages/core/win-spawn.js (or equivalent) extracted; config.js and pair-programming.js both consume it; no shell:true/shell:win32 remains in pair-programming.js"
  - "Reviewer prompt delivered via stdin, not argv, in both runReviewerLlm paths"
  - "pair-programming rex status excerpt spawn is Windows-safe (no bare .cmd execFileSync)"
  - "sourcevision's two rex spawn sites are Windows-safe via the least-invasive route (existing llm-client surface if present, else process.execPath + resolved rex entry); no new cross-package dependency added solely for this"
  - "Parity test extended to cover the extracted core helper"
  - "TDD: new tests written first where the module is unit-testable; full suite green; ci.js/pr-check pnpm sites explicitly documented as out-of-scope follow-up"
description: "The audit's exhaustiveness sweep found spawn sites the original four-site inventory missed. IN SCOPE for this branch: (1) packages/core/pair-programming.js — line ~226 execFileSync(cliPath,[\"--version\"],{shell:win32}); lines ~349 and ~394 spawn(cliPath, args, {shell:win32}) for the reviewer vendor CLI, which ALSO pass the multi-line reviewer prompt as an argv token (same cmd.exe newline hazard as the codex adapter — move the prompt to stdin; claude -p reads stdin, mirror how cli-provider does it); line ~68 execFileSync(\"rex\", ...) — bare .cmd shim spawn that EINVALs on Windows. pair-programming.js is orchestration tier (MUST NOT import llm-client): extract config.js's execFileSyncCli + the cmd.exe verbatim spawn recipe into a small shared core-local module (e.g. packages/core/win-spawn.js) consumed by BOTH config.js and pair-programming.js — this also collapses the core-side duplication to one copy for the parity test. (2) packages/sourcevision/src/analyzers/branch-work-collector.ts:150 and src/cli/commands/prd-epic-resolver.ts:~79 — execFileSync(\"rex\", [\"parse-md\",\"--stdin\"], ...) bare .cmd spawns that fail EINVAL on Windows, silently degrading branch analysis. sourcevision is domain tier and MAY import the foundation package: check whether sourcevision already depends on @n-dx/llm-client (see package.json and any existing import convention, e.g. analyzers/claude-client.ts); if yes, route via spawnCli/execFileSync-equivalent through the established import surface (respect any gateway convention); if no dependency exists, prefer resolving the rex JS entry and spawning process.execPath [rexEntry, ...args] to sidestep the .cmd shim entirely — do NOT add a new cross-package dependency just for this. OUT OF SCOPE (record in the PR body + follow-up issue at PR time): ci.js / pr-check.js pnpm .cmd spawns, and any test-only helpers. TDD: failing tests first per touched module where feasible (unit-test the extracted core helper against the parity table; regression test that sourcevision's rex spawn path constructs a Windows-safe invocation)."
---
