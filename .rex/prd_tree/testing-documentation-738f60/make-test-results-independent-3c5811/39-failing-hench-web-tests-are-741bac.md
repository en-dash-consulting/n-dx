---
id: "741bacf1-0314-4bc3-8f50-400e8c673bfb"
level: "task"
title: "39 failing hench/web tests are hidden because rex's flakes abort the run first"
status: "pending"
priority: "high"
tags:
  - "testing"
  - "ci"
  - "flakiness"
  - "hench"
  - "web"
  - "visibility"
source: "exploration-2026-08-17"
acceptanceCriteria:
  - "A failing package no longer prevents later packages in the topological order from running; every package reports its own result"
  - "Confirmed whether hench/web are red on main in CI too, given the ubuntu job runs the same `pnpm -r run test`"
  - "The 32 hench and 7 web failures are triaged individually with their causes recorded"
  - "Any failure that is Windows-specific is identified as such rather than assumed universal"
  - "A full local run surfaces every package's result, so the total failure count is trustworthy"
description: "Discovered while verifying the FORCE_COLOR fix: `pnpm test` has NEVER been running the hench or web suites in this working tree, and both are red.\n\nMECHANISM. `pnpm test` is `run-vitest-bind-aware.mjs root && pnpm -r run test`. The recursive step runs packages in topological order — llm-client, sourcevision, rex, then hench and web (which depend on rex). rex's four load-sensitive wall-clock tests (task 676af18f) fail on essentially every full run, pnpm stops, and hench/web never execute. Across every full-suite run in this session their result lines were simply absent from the output, which reads as \"nothing to report\" rather than \"never ran\".\n\nMEASURED by invoking them directly:\n  hench: 32 failed / 2851 passed / 12 failed files (151 total)\n  web:    7 failed / 2864 passed /  4 failed files (176 total, 2 skipped)\n\nNOT caused by the color work and NOT color-related. Each was run twice, with FORCE_COLOR=3 COLORTERM=truecolor and with both unset, and the counts are byte-identical. hench was additionally re-run with the whole color changeset stashed (`git stash -u`) and produced the same 32/12 — so the failures pre-date it entirely.\n\nTWO SEPARATE PROBLEMS, both worth fixing:\n\n1. THE MASKING. A failing package must not silently prevent later packages from running, or a red suite looks like a shorter green one. Options: `pnpm -r --no-bail run test` (or the current equivalent) so every package reports; or split per-package CI steps so each has its own status. Note this interacts with CI — the ubuntu job runs `pnpm -r run test`, so CI has the same blind spot, meaning hench and web may be red on main right now without anyone seeing it. Check that first.\n\n2. THE 39 FAILURES themselves, cause unknown — not investigated here beyond establishing they are neither color- nor change-related. They could be genuinely broken, environment-dependent, or Windows-specific (this measurement was taken on Windows 11, and per the cross-OS epic the suite has only ever been exercised on ubuntu in CI). Triage per failure; do not assume a single root cause.\n\nFixing the masking should come first — it is small, and it makes the 39 visible so they can be triaged with real output instead of being rediscovered by accident."
---
