---
id: "248236d8-2f12-46ed-8b7f-5087eba15d14"
type: "task"
title: "ndx work --resolve does not report the --require-unblocked refusal a real run would raise"
slug: "ndx-work-resolve-does-not-report-the"
description: "Verdict: should-fix (low), found by the adversarial review of bd1d2e1d (run 22b117bb).\n\nDefect: `ndx work --task=<id> --resolve` promises to list every reason a run would refuse to start. The new `--require-unblocked` refusal (openBlockersRefusal, packages/hench/src/agent/planning/brief.ts, called from selectTaskEntry) is not mirrored in packages/hench/src/cli/commands/run-resolve.ts. That file only checks inbox, explicitTaskRefusal and claims.\n\nScenario: task B is blockedBy a pending task A. `ndx work --task=B --require-unblocked --resolve .` reports no refusal, but `ndx work --task=B --require-unblocked --auto .` refuses and exits 1.\n\nReachable: any operator who previews a --plan-queue lane step with --resolve. Nothing is corrupted; the preview is simply wrong.\n\nOptions:\n1. In run-resolve.ts, when flags[\"require-unblocked\"] === \"true\", call openBlockersRefusal(entry.item, prdItems, v2Tree) and refuse with a new RunRefusalCode \"blocked\". Cheap (a few lines plus a test). Recommended.\n2. Document that --resolve ignores --require-unblocked. Cheaper, but it leaves the contract broken."
acceptanceCriteria:
  - "ndx work --task=<id> --require-unblocked --resolve on a task with a non-completed blocker lists a refusal naming each open blocker (test)"
  - "Without --require-unblocked, or when every blocker is completed, --resolve reports no blocker refusal (test)"
  - "The new refusal code is listed in RunRefusalCode and the --resolve help text"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
