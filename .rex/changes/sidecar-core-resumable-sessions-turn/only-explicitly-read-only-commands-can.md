---
id: "b9161bd9-3d30-46d4-b54b-bd9b1e81f544"
type: "task"
title: "Only explicitly read-only commands can be allow-listed through run_command"
slug: "only-explicitly-read-only-commands-can"
description: "#901 F2 (medium, must-fix). commandNeverAllowListed in broker-policy.ts blocks only the words work, reset and push, so allowListKey(\"run_command\", {argv}) returns a key for `ndx hench run --task=abc .` (the autonomous agent through `ndx hench`), `ndx self-heal .` (runs hench), `ndx rex add task x .` (a PRD write) and `git clean -fdx`. The operator is offered \"remember\", decide() writes the rule to allow-list.json, and the re-validation on read uses the same predicate, so it keeps it. Once M3 carries out run_command, every later identical call runs with no card. That contradicts the M1 change's criterion c3.\n\nDecided: option (a). Invert the rule so only argv that begins with an explicit read-only prefix can be remembered; everything else returns null. Because allowList() re-validates on read, rules already on disk drop out by themselves.\n\nSource: Adversarial review by Hal (endash-shal), 2026-11-04 on #901."
acceptanceCriteria:
  - "allowListKey(\"run_command\", {argv}) returns a key only when argv begins with an entry on an explicit read-only list (at least ndx status, ndx usage, git status, git log, git diff, git show) and null for every other argv"
  - "sidecar-broker.test.ts asserts null for: ndx hench run --task=abc ., ndx self-heal ., ndx rex add task x ., git clean -fdx, ndx work ., git push, ndx analyze ."
  - "An allow-list.json rule whose argv is off the read-only list is dropped when the allow-list is read, with a test"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "review:#901-F2"
source: "ndx-adversarial-review"
---
