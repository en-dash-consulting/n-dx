---
id: "ba6e02f5-3d4e-49d0-a57b-6ba2632c36cf"
level: "task"
title: "DEP0190 guard test: fail if any CLI spawn reintroduces shell:true"
status: "pending"
priority: "medium"
tags:
  - "windows"
  - "testing"
  - "gh:37"
  - "gh:68"
blockedBy:
  - "a585caf7-a74d-4850-a9d9-046553359e47"
acceptanceCriteria:
  - "Guard test fails if any CLI-binary spawn site reintroduces shell:true + args"
  - "Guard test lives with the other architecture-policy / boundary tests"
  - "Full suite still green with the guard in place"
description: "Add a cross-cutting guard test (architecture-policy style, alongside tests/e2e/architecture-policy.test.js) that scans the CLI-binary spawn sites and FAILS if any reintroduces `shell: process.platform` or shell:true combined with an args array (the DEP0190 pattern). The per-feature correctness tests (quoteWindowsToken, buildWindowsCliCommandLine, .cmd-without-EINVAL, path-with-spaces, diagnostic branches) live in their own implementation tasks under TDD — this task is only the regression lock that prevents future backsliding once the four sites are converted."
---
