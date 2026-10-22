---
id: "5db09032-fd81-4c9a-be03-e47787b62282"
level: "task"
title: "A failed manual flow leaves the agent process tree running: afterAll stops only the dashboard"
status: "pending"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
  - "web"
  - "testing"
  - "playwright"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Each manual spec's afterAll terminates every active run through the hench execute terminate route and waits (bounded) for no run to be active before stopping the dashboard"
  - "A test on the helper (fake server or route-level) shows a run that is still active is terminated before the dashboard is stopped"
  - "Interrupting a manual flow mid-run leaves no ndx work or vendor CLI process alive afterwards (manual verification noted in the PR)"
description: "Severity: high. Verdict: must-fix (reachable on every mid-run failure; the cost is real token spend and a held temp directory).\n\nFAILURE SCENARIO\nA manual flow fails or times out while the agent is mid-run (as happened twice during the suite's own development). test.afterAll in prompt-to-completion.spec.ts, analyze-add-complete.spec.ts and vendor-switch-iterations.spec.ts calls stopDashboard(proc) (SIGTERM on the `web serve` process) and then cleanupFixtureProject(dir). On Windows the server's children — `ndx work` → `claude` — are not in a process group and nothing walks the tree, so they keep running: the vendor keeps being called, run records keep being written into a directory rm is deleting (EBUSY after the retries), and a console window stays open after the suite exits.\n\nEVIDENCE: packages/web/tests/e2e-ui-manual/*.spec.ts afterAll blocks; packages/web/tests/e2e-ui/helpers/fixture-project.ts:178 stopDashboard; no call to the product's stop routes anywhere in the suite.\n\nSOLUTIONS\n1 (recommended): before stopping the dashboard, list runs through GET /api/hench/runs, POST /api/hench/execute/:taskId/terminate for each active one, poll until none is active (bounded), then stopDashboardAndWait. Uses the product's own stop path and leaves a clean tree for cleanup.\n2: taskkill /T on the server pid on win32 — blunter, also covers sv analyze children; acceptable as the fallback after 1 if a run does not stop."
lastModified: "2026-10-13T19:10:01.200Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
