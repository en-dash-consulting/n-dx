---
id: "d277c5ce-3ec5-4625-9fb6-85c158e5f10a"
level: "feature"
title: "Playwright browser suites: hardening from the adversarial review of the manual and happy-click suites"
status: "pending"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "web"
  - "testing"
  - "playwright"
source: "ndx-adversarial-review"
acceptanceCriteria: []
description: "Container for the must-fix and should-fix findings of the 2026-10-13 /ndx-adversarial-review of commits d925158ce and e601237f3 on feat/playwright-manual-and-happy-click: the manual real-vendor Playwright suite (packages/web/tests/e2e-ui-manual) and the happy-click specs (packages/web/tests/e2e-ui/happy-click). Each child task carries its own failure scenario, evidence and solution; the review's not-worth-fixing findings (probe fetch without timeout, trace size on long runs, sweep de-duplication by name) are recorded in the review summary and deliberately not filed."
lastModified: "2026-10-13T19:08:29.882Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [A failed manual flow leaves the agent process tree running: afterAll stops only the dashboard](./a-failed-manual-flow-leaves-the-agent.md) | pending |
| [A manual spec whose dashboard fails to start leaks its fixture directory](./a-manual-spec-whose-dashboard-fails-to.md) | pending |
| [Flow 2 navigates away right after clicking Full analysis, racing the POST that starts it](./flow-2-navigates-away-right-after.md) | pending |
| [hasCli uses shell: true with an args array and trips Node's DEP0190 on every manual run](./hascli-uses-shell-true-with-an-args.md) | pending |
| [openLiveTask falls back to the newest run of any status and can open a previous leg's completed task](./openlivetask-falls-back-to-the-newest.md) | pending |
| [settings.spec's feature-toggle API check asserts the response contains the key, which it always does](./settings-spec-s-feature-toggle-api.md) | pending |
| [The happy-click sweep can press status-picker options: the listbox is never dismissed and option names are not denied](./the-happy-click-sweep-can-press-status.md) | pending |
| [The manual flows' headSha assertion is vacuous: the baseline is taken before the spec's own commitAll](./the-manual-flows-headsha-assertion-is.md) | pending |
