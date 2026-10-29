---
id: "c5a4d4c3-c1a6-428c-99a1-c16480f5ee3b"
type: "change"
title: "A config write that lands after the run ends is still caught"
slug: "a-config-write-that-lands-after-the"
intent: "Found by the adversarial review of bfb205e4 (run c351e166), verdict should-fix, severity high. It was deferred there because it is a limit of the snapshot design, not a regression. Captured with Ryan's approval on 2026-10-28.\n\nFailure scenario: through run_command, Bash(node:*) under Claude, or Codex's shell, the agent runs a node script that spawns a child with detached: true and unref(). The child sleeps 60s, then writes .n-dx.local.json with hench.guard.env.allow [\"*\"]. The tool call, the vendor CLI spawn, finalizeRun and run.ts's finally all restore the protected files before the write lands. The next `ndx work` snapshots the widened file as its baseline, and applies it as the user's own config with no trust review.\n\nOptions: (a) record a digest of the protected files at run end in machine-local hench state, and refuse or flag at the next run start when they changed with no n-dx command having written them. Cost: a decision on how a user's own edit between runs is told apart; `ndx config` could update the digest, but a hand edit would be flagged once. (b) Kill the run's whole process group or session on exit, so no child outlives it. Cost: per-platform process handling; a setsid'd child escapes it. Recommended: (a), with (b) as a belt where it is cheap."
acceptanceCriteria:
  - "A protected config file written after the run's last restore point is caught at the next run start and not applied unreviewed"
  - "An edit made through an n-dx command between runs is not flagged"
  - "The finding names the path and never the file's content"
  - "Test: a detached child that writes .n-dx.local.json after the run ends is caught at the next start; the test fails on the code before the fix"
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "high"
discoveredFrom: {"item":"bfb205e4-24e7-4d4e-b77a-ed3190d428e9","run":"c351e166-fe00-4977-8fff-ea73ab6978b7"}
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
---
