---
id: "642df761-d076-4309-bd5c-edba76604dfd"
level: "feature"
title: "Between-Run API Quota Status Logging"
status: "completed"
source: "smart-add"
startedAt: "2026-04-08T20:46:18.155Z"
completedAt: "2026-04-08T20:46:18.155Z"
description: "After each hench run completes, check remaining API quota or configured budget headroom for Claude and Codex providers and report it to the user in the run log with color-coded warnings at threshold boundaries."
---

## Children

| Title | Status |
|-------|--------|
| [Define typed quota result interface and identify invocation point in hench run loop](./define-typed-quota-result-interface-and-af8ede6d/index.md) | completed |
| [Implement budget-based percent-remaining calculation for active providers](./implement-budget-based-percent-41169580/index.md) | completed |
| [Implement ANSI color-coded quota log formatter](./implement-ansi-color-coded-quota-log-4fbde3c0/index.md) | completed |
| [Integrate quota log output into hench run console with quiet/JSON suppression](./integrate-quota-log-output-into-hench-ac656b7b/index.md) | completed |
