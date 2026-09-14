---
id: "7775138a-73c6-415d-9e4e-bd54484b577a"
level: "task"
title: "Make Windows exec-timeout tree-kill start proof deterministic"
status: "pending"
priority: "high"
acceptanceCriteria:
  - "The fixture records an immediate, deterministic ready marker before its delayed periodic output, and the test asserts that marker instead of relying on a later tick."
  - "The test still proves the process was alive at timeout and that no child or grandchild writes after exec returns its timeout result."
  - "The timeout/tree-kill behavior remains exercised on both Windows and POSIX without skipping the Windows test or merely extending its timeout."
  - "The focused @n-dx/llm-client test is stable under repeated runs and Windows CLI Smoke passes."
description: "Windows CLI Smoke fails intermittently in @n-dx/llm-client tests/integration/exec-timeout-tree-kill.test.ts because the assertion requires a delayed tick before the 700ms timeout. The process can have started and written its PID but not reached the first 150ms interval when the timeout fires. Replace elapsed-time evidence with an immediate, observable ready marker while preserving the essential contract: a reported timeout terminates the full process tree and no descendant writes after the timeout. This blocks PR #371 CI after the claim-lifecycle Windows fix passed."
lastModified: "2026-09-14T04:35:30.730Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
