---
id: "c4333256-6e2d-4c9f-aeaa-6a772e17fb88"
type: "task"
title: "Vendor CLI probes and preflights get the vendor's filtered environment, not the whole parent environment"
slug: "vendor-cli-probes-and-preflights-get"
description: "Whole-stack adversarial re-review of #816 + #817 (diff mode, origin/main...fix/security-child-env at abf90b308), 2026-10-28, finding E1 (high, must-fix; pre-existing, but contradicts this layer's title).\n\nFailure scenario: `ndx auth`, `ndx config llm.vendor …` and `ndx init`'s soft preflight spawn `claude -p …` / `codex exec …` with no env and cwd set to the project (packages/core/config.js:1678 runVendorAuthPreflight); the cli_path connection test does the same (config.js:1047 testCliPath); the dashboard's probeCli (packages/web/src/server/llm-catalog.ts:82, touched by this layer) spawns the vendor binary with no env too. Every credential in the operator's shell reaches the vendor CLI, and through it anything the CLI runs, while the agent loop's vendor CLI gets only its own mode's credentials.\n\nProbed: a fake claude set as cli_path in a trusted fixture saw every fake credential the probe exported.\n\nOptions: pass the same filtered environment the agent loop uses: core through its existing loader (loadVendorCliEnv or equivalent), web through resolveVendorCliEnv(config) behind the domain gateway. Update tests/shell-spawn-inventory.md and child-process-allowlist.json if a row changes. Cost: small; risk: a preflight that relied on an unrelated variable now fails, which is the point."
acceptanceCriteria:
  - "Closes #686 (finding 3, follow-up): every vendor CLI spawn n-dx makes outside the agent loop gets the vendor's filtered environment"
  - "runVendorAuthPreflight, testCliPath and the dashboard's probeCli pass an explicit env built by the same resolver the agent loop uses"
  - "Test: a sentinel credential outside the vendor's mode does not reach a stub CLI spawned by each of the three paths; the test fails on the code before the fix"
priority: "high"
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
---
