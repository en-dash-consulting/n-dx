---
id: "eb83e835-b538-4aab-bb2f-ba34775cbcc3"
level: "task"
title: "Make CLI progress monotonic and print retries on their own line"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "trust-copy"
  - "wm-2044"
source: "caos work management: WM2044 (Make CLI progress monotonic and print retries on their own line); 0.7.1 execution plan PR group"
acceptanceCriteria:
  - "A unit test drives the progress reporter through phase and batch transitions and asserts the displayed counter never decreases within a command."
  - "Retries print as separate 'retry n/m' lines in all three LLM providers; the progress line is redrawn after."
  - "`ndx analyze --format=json` and `hench run --format=json` outputs are byte-identical to before."
  - "The change is visible in an interactive `ndx analyze` on a project that triggers at least one retry (documented in the PR)."
description: "Progress output in the CLIs can appear to move backwards when a counter resets between phases or batches, and rate-limit retries overwrite the progress line. The LLM client already prints 'Rate limited — retrying in Ns… (attempt n of m)' to stderr in packages/llm-client/src/api-provider.ts, cli-provider.ts and codex-cli-provider.ts. Make every progress counter in sourcevision analyze and hench runs monotonic within a command (phase-qualified counters or a running total), print each retry as its own line in the form 'retry n/m: <reason>' without disturbing the progress line, and leave --format=json output untouched.\n\nImplementation notes: Find every place sourcevision analyze and the hench run loop print progress counters to a TTY (start from the spinner and stage labels work under the PRD epic 'ndx plan post-LLM progress' and the analyze command's progress output), and route them through one reporter that qualifies counters by phase or keeps a running total so the number shown never decreases within a command. In packages/llm-client/src/api-provider.ts, cli-provider.ts and codex-cli-provider.ts, change the rate-limit messages to the form 'retry n/m: rate limited, waiting Ns' on their own line and make sure the reporter redraws the progress line afterwards. Add a unit test for monotonicity and one for the retry line format. Do not change any --format=json output. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-21T17:24:15.071Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
