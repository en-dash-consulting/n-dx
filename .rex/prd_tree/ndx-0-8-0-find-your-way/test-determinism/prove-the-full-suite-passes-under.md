---
id: "45bb2888-01fe-49b7-b06b-079c16491ec9"
level: "task"
title: "Prove the full suite passes under concurrent build load three times in a row"
status: "completed"
priority: "medium"
tags:
  - "0.8.0"
  - "test-determinism"
  - "pr-16"
blockedBy:
  - "2098655c-94ac-489b-a012-c6db319d8767"
  - "26ce64cf-a0e4-4ac7-ad61-92973dce3b96"
  - "74d203ab-e6c5-49c4-a73f-3c9116257734"
  - "518ece53-aad7-4902-a899-9de45f6635d8"
source: "caos work management: WM-2146 (Prove the full suite passes under concurrent build load three times in a row); 0.8.0 planning, PR 16 · Test determinism"
startedAt: "2026-09-28T18:27:24.943Z"
completedAt: "2026-09-28T20:22:31.203Z"
endedAt: "2026-09-28T20:22:31.203Z"
resolutionType: "code-change"
resolutionDetail: "Criterion met: three consecutive full-suite runs green under concurrent build load.\n\nCOMMIT UNDER TEST: 5900f9a6 (\"test: scale the ci child-cleanup waits with the documented load allowance\").\nMACHINE: Intel Core Ultra 5 225F, 10 logical CPUs, 31.5 GB, Windows 11 26200, Node 24.16.0, pnpm 10.33.0.\nHARNESS: `node scripts/soak-under-build-load.mjs --runs=3` (2 concurrent tsc workers, default).\n\n| run | verdict | wall | compilations alongside |\n|---|---|---|---|\n| 1 | PASS | 6m 54s | 138 (0 non-zero) |\n| 2 | PASS | 6m 46s | 137 (0 non-zero) |\n| 3 | PASS | 6m 55s | 137 (0 non-zero) |\n\n6/6 suites passed in every run, identical counts each time: root 2737 passed / 13 skipped, hench 3991 / 13, llm-client 1423, rex 5374 / 27, sourcevision 2229, web 4062 / 7 — 19,816 passed and 60 skipped per run, 59,448 passing test results across the three. Zero flakes, zero retries, no rerun-until-green.\n\nLOAD METHOD, and why it is not a literal `pnpm build`. rex, hench and llm-client do not set `incremental`, so a real `pnpm build` truncates and rewrites the `dist/` entry points the root e2e suite spawns dozens of times per run — a test handed a half-written `packages/rex/dist/cli/index.js` fails with a SyntaxError that says nothing about clock-bound assertions. That is mutation of the system under test wearing the costume of load. The harness instead does the build's WORK without touching its OUTPUT: the same `tsc` invocations, `--outDir` redirected to a scratch directory in the OS temp dir, `--incremental false` so no worker coasts on a `.tsbuildinfo`. Parse, typecheck, emit, sourcemaps and declarations all happen. The load is reported rather than assumed — the per-run compilation count above is what makes a load that never ran visible instead of silently downgrading this to three plain suite runs.\n\nWHAT IT TOOK TO GET HERE. The first attempt at this task (commit c12a1f98) failed run 1 and filed two tasks rather than rerunning: the prd-tree write-volume fixtures (4c318f7c, fixed in 46133919) and this file's raw polling deadlines (9830182a, fixed in 5900f9a6 as part of this task, since the criterion could not be met while a known load-sensitive test remained). Both were fixture/guardrail sizing, not assertions — the four clock-bound assertion fixes this feature was scoped around held up under load on their first exposure.\n\nSCOPE OF THE CLAIM. Three runs on one machine at one load level is evidence, not proof: it does not cover CI's ubuntu/macOS runners, higher worker counts, or load shapes other than CPU saturation (a disk- or memory-bound machine is untested). Re-run the harness rather than trusting this record when the suite changes shape."
acceptanceCriteria:
  - "The full suite passes under concurrent build load three times in a row; the runs and load method are recorded in the task."
description: "Closing check for Test determinism once the four clock-bound fixes land: a red test gate should mean the code is wrong, not that the machine was busy.\n\nImplementation notes: Run pnpm test three times while a concurrent pnpm build runs; record commit, machine and results. File a new task for any failure rather than rerunning until green. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-28T20:22:31.974Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
