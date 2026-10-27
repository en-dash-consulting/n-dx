---
id: "d3618484-b8ab-4ed5-a162-7602873aa162"
type: "task"
title: "Harden SourceVision test execution against lingering workers and orphaned threads"
slug: "harden-sourcevision-test-execution"
description: "Audit the SourceVision test/runtime paths that can continue running after completion and make them participate in the same shutdown contract so nonstop unit-test activity does not linger on developer machines."
acceptanceCriteria:
  - "SourceVision test-related subprocesses or workers are routed through the shared cleanup mechanism instead of unmanaged direct spawns"
  - "Known long-running or watch-like test helpers used by SourceVision are explicitly shut down when the parent workflow completes"
  - "No orphaned SourceVision-related child process remains after a representative test workflow finishes in a regression scenario"
  - "Failure paths during SourceVision test execution still trigger cleanup of already-started workers or subprocesses"
priority: "critical"
tags:
  - "sourcevision"
  - "tests"
  - "threads"
  - "process-management"
source: "smart-add"
---
