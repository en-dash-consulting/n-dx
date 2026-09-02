---
id: "469c7900-cd34-4919-bc40-5f474a96654a"
level: "feature"
title: "Ctrl-C Interrupt Rollback Prompt Coordination"
status: "completed"
source: "smart-add"
startedAt: "2026-04-24T21:00:00.715Z"
completedAt: "2026-04-24T21:00:00.715Z"
acceptanceCriteria: []
description: "When the user interrupts the work loop with Ctrl-C, the existing SIGINT handler (which calls process.exit(1) on a second Ctrl-C) remains active while the rollback confirmation prompt is waiting for readline input. Any Ctrl-C during the prompt immediately kills the process before the user can answer. The handler must be suspended for the duration of the rollback prompt and restored (or replaced with the default) afterward."
---

## Children

| Title | Status |
|-------|--------|
| [Add integration tests for Ctrl-C interrupt and rollback prompt interaction](./add-integration-tests-for-ctrl-20bbb6.md) | completed |
| [Suspend custom SIGINT handler during rollback confirmation prompt](./suspend-custom-sigint-handler-5cfeee.md) | completed |
