---
id: "459057dc-b0be-4725-8d20-074b1f2b0fb8"
type: "change"
title: "A failed dashboard run's Live error line shows a stderr warning instead of hench's stdout refusal"
slug: "a-failed-dashboard-run-s-live-error"
intent: "Out-of-scope finding from the adversarial review of 3dbce690. It predates that change.\n\nWhat goes wrong: a dashboard-started `ndx work` (POST /api/hench/execute) on a dirty tree where hench also warns about a config field. hench writes the warning to stderr through warn() and the refusal to stdout through info(), then exits 1. The `.then` handler in packages/web/src/server/routes-hench.ts (around line 2570) sets `entry.state.error = result.stderr.slice(-200) || lastOutLine`. Stderr is not empty, so the broadcast execution state carries only the warning, and Live and the task card show it as the reason. The refusal and its file list never appear.\n\nReachability: any dashboard run that hench refuses while it also warns. The same pairing is what #989's review found for the Sidecar path, which 3dbce690 fixed with runEndOutput().\n\nOptions:\n1. Build the error from `runEndOutput(result.stderr, result.stdout, <small cap>)`. This is cheap. Risk: the 200-character budget cuts the refusal's header if the file list is long, so take the tail of each stream separately.\n2. Prefer the stdout line that starts with \"Refusing\" when there is one. This is brittle text matching.\n\nRecommendation: option 1, with a per-stream cap."
acceptanceCriteria:
  - "When a dashboard run exits 1 with a warning on stderr and a refusal on stdout, the broadcast execution state's error contains the refusal (web test)"
  - "When a dashboard run exits 1 with only stderr output, the broadcast execution state's error still contains it (web test)"
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
