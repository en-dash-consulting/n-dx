---
id: "e2fb42b1-e547-4682-a2ef-176d0e7d7857"
type: "change"
title: "PHP stack review fixes: resolution scoping, namespace-aware shadowing, database flow and slow regexes"
slug: "php-stack-review-fixes-resolution"
summary: "Fix the problems a code review and GitHub's security scanner found in the PHP language pack: wrong links between apps that share a repository, hidden findings when a helper reuses a built-in function's name, missed or over-reported database-driven code, and text patterns that could stall on unusual files."
intent: "PR 11 of the PHP language-pack stack, stacked on PR 10 (#1081). Ryan chose (2026-11-16) to fix every review finding in one PR on top of the stack rather than restack the PRs below. The findings are:\n- five P2 Codex findings Ryan posted on #1053, #1075 and #1081, each reproduced against stack tip 72b36ae7b;\n- eleven CodeQL js/polynomial-redos alerts, #124–#134, on #1053, #1057, #1059, #1060, #1063 and #1081.\n\nEach task names the threads or alerts it closes, so the PR body can map fixes to comments.\n\nLane rules (PHP pack; decisions made 2026-11-12):\n- Behaviour stays the same except where a finding says it is wrong. Existing goldens change only for the cases a task fixes, and every changed golden is explained in the task log.\n- Analyze output stays byte-identical for every repository without PHP files, and for PHP repositories without the pack.\n- Agents cannot use the network, run `pnpm install`, read `~/.cache`, or write under `.claude/`. The operator does those steps.\n- Record measurements with append_log on the task.\n- Patch changesets with scoped package names, at the current fixed-group version.\n- Before finishing, run the six static root policy tests: tests/e2e/architecture-policy.test.js, domain-isolation.test.js, shell-spawn-inventory-policy.test.js, wall-clock-inventory-policy.test.js, layout-literal-policy.test.js, obfuscated-code-policy.test.js."
acceptanceCriteria:
  - "Each of the five Codex findings has a regression test that reproduces the reported case and passes"
  - "None of the eleven CodeQL polynomial-redos patterns remains, and each replacement has a test that runs a pathological input in linear time"
  - "Analyze output for repositories without PHP, or without the pack, is byte-identical"
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "high"
tags:
  - "php"
  - "lang-php"
  - "php-pr11"
  - "review-fixes"
blockedBy:
  - "ec248078-5c99-4dd6-b4a8-b7d4311313f6"
---
