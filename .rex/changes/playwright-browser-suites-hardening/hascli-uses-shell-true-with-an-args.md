---
id: "3367feeb-2a9f-4b7f-8b25-6feb7ea4d7eb"
type: "task"
title: "hasCli uses shell: true with an args array and trips Node's DEP0190 on every manual run"
slug: "hascli-uses-shell-true-with-an-args"
description: "Severity: low. Verdict: should-fix (the repo has a DEP0190 guard test for src; this is the same deprecation in a test helper, and a future Node major will refuse it).\n\npackages/web/tests/e2e-ui-manual/helpers/preconditions.ts:9 runs execFileSync(name, [\"--version\"], { shell: true }) on win32 so the .cmd shim resolves. Node prints \"[DEP0190] Passing args to a child process with shell option true…\" on every run. Fix: resolve the binary first with `where`/`which` through execFileSync without a shell (as llm-client's exec.ts:910 does), or pass one command string when shell is set."
acceptanceCriteria:
  - "Running the manual suite prints no DEP0190 warning"
  - "hasCli still returns true for an installed claude on Windows and false for an absent codex"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "web"
  - "testing"
  - "playwright"
  - "windows"
source: "ndx-adversarial-review"
---
