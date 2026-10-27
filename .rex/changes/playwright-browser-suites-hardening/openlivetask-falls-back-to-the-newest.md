---
id: "4d41b19c-5597-482a-986e-c28b08ff2e08"
type: "task"
title: "openLiveTask falls back to the newest run of any status and can open a previous leg's completed task"
slug: "openlivetask-falls-back-to-the-newest"
description: "Severity: medium. Verdict: should-fix.\n\nFAILURE SCENARIO\npackages/web/tests/e2e-ui-manual/helpers/run-watch.ts openLiveTask polls GET /api/hench/runs and, when no run matches expectedTaskId, takes the first run that is active, completed or failed. In vendor-switch-iterations.spec.ts the Codex leg calls it right after Start now while the Claude leg's three completed runs already exist; if the new run is not yet recorded, the helper returns the Claude leg's last task and opens its page. Today that leg waits on run counts, so the video shows the wrong page but the assertion holds; a future spec that pairs openLiveTask with waitForLiveTaskCompleted would see \"completed\" immediately and pass falsely.\n\nSOLUTION: snapshot the run ids before clicking Start now and accept only a run not in that set (optionally also started after the click); fail with the run list when none appears within the timeout."
acceptanceCriteria:
  - "openLiveTask takes the set of run ids known before Start now and ignores them when choosing the started run"
  - "A helper test shows that with a pre-existing completed run and no new run, openLiveTask keeps waiting rather than returning the old task"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "web"
  - "testing"
  - "playwright"
source: "ndx-adversarial-review"
---
