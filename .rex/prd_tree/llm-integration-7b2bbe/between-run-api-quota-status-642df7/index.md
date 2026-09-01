---
id: "642df761-d076-4309-bd5c-edba76604dfd"
level: "feature"
title: "Between-Run API Quota Status Logging"
status: "completed"
source: "smart-add"
startedAt: "2026-04-08T20:46:18.155Z"
completedAt: "2026-04-08T20:46:18.155Z"
acceptanceCriteria: []
description: "After each hench run completes, check remaining API quota or configured budget headroom for Claude and Codex providers and report it to the user in the run log with color-coded warnings at threshold boundaries."
---

## Children

| Title | Status |
|-------|--------|
| [Define typed quota result interface and identify invocation point in hench run loop](./define-typed-quota-result-af8ede.md) | completed |
| [Implement ANSI color-coded quota log formatter](./implement-ansi-color-coded-4fbde3.md) | completed |
| [Implement budget-based percent-remaining calculation for active providers](./implement-budget-based-percent-411695.md) | completed |
| [Implement Codex API quota fetch and normalize response to QuotaRemaining](./implement-codex-api-quota-fetch-208d64.md) | completed |
| [Integrate quota log output into hench run console with quiet/JSON suppression](./integrate-quota-log-output-into-ac656b.md) | completed |
