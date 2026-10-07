---
id: "7ffad560-ded2-4526-8df2-5e6471416e73"
level: "task"
title: ".claude/rules accepts any new policy file with a table; only *-injection-seams.md names are blocked"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "core"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A test fails when any file under .claude/rules/ contains a Markdown table row, whatever its name"
  - "A test fails when a file under .claude/rules/ does not name the AGENTS.md section it points at"
description: "Found by an adversarial review of commit 7e7ef5666 (task b88dba61). Verdict: should-fix, low.\n\nScenario: the generated CLAUDE.md now says .claude/rules/ \"is for pointers, not content: do not add a registry or a policy table here\". The guard in tests/e2e/instruction-alignment.test.js (\"no package beyond core and web has a .claude/rules seam registry\") only matches filenames ending in -injection-seams.md. Adding .claude/rules/rex-zone-policy.md (or hench-gateways.md) containing a policy table, with paths: packages/rex/**, passes every test, and that guidance is again visible to Claude Code only - the same gap b88dba61 closed.\n\nReachable: any contributor or agent adding a path-scoped rule. Nothing else checks .claude/rules content.\n\nOptions:\n(a) Recommended, and natural to fold into f2d64d8a (which rewrites these assertions anyway): assert that no file in .claude/rules/ contains a Markdown table row, and that every file there names an AGENTS.md. Cheap; the three existing files would need to be pointers first, so it belongs after or inside f2d64d8a.\n(b) Allowlist the filenames in .claude/rules/. Stricter, but makes every legitimate new pointer a test edit."
lastModified: "2026-10-06T23:17:53.653Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
