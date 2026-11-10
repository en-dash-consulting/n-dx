---
id: "c1931e8b-b21b-432d-b800-e519b9332b80"
type: "task"
title: "A policy test fails any user-facing message that prescribes a manual restart or rebuild"
slug: "a-policy-test-fails-any-user-facing"
description: "Add a test under tests/e2e (beside architecture-policy) that scans user-facing strings in packages/core and packages/web/src (thrown errors, console output, API problem text, lastError) and fails any that gives 'ndx hub stop', 'pnpm build', 'pnpm install' or a restart of the hub/server as the fix. Help text and the 'Stop:' line describing ndx hub stop are listed exceptions, each with a reason. SAFETY: the operator's live hub runs on 127.0.0.1:3117 with ~/.n-dx as its home and serves 25 projects. Never run 'ndx hub stop', 'ndx start' or anything that stops, replaces or registers with that hub. Every test and manual check uses a temporary NDX_HOME and a free port (hub.port / --port)."
acceptanceCriteria:
  - "The test fails on a newly added message such as \"restart the hub with ndx hub stop\""
  - "Every remaining exception is listed in the test with a reason"
  - "The test passes on this branch once the other tasks land"
priority: "high"
source: "ndx-capture"
blockedBy:
  - "c4e62e1c-54e8-48e8-92c3-71fc0b7aba7c"
  - "98e5a4d9-0b50-4124-a5a9-9745366d2af8"
  - "955f7405-6bab-45f7-8722-b7595000a98f"
  - "bf09d14d-b75d-4d34-88e6-967948cd0e63"
---
