---
id: "b714bd5d-c003-423e-a367-e759ae74eba1"
level: "task"
title: "Emit structured smoke artifacts with normalized error codes"
status: "completed"
priority: "critical"
tags:
  - "ci"
  - "artifacts"
  - "cross-platform"
  - "testing"
source: "smart-add"
startedAt: "2026-04-07T22:47:23.170Z"
completedAt: "2026-04-07T22:50:03.750Z"
acceptanceCriteria:
  - "Smoke artifacts include normalized error code fields for failed command executions"
  - "Artifact schema distinguishes error code from platform-specific stderr or path details"
  - "Successful runs continue to emit artifacts without introducing placeholder failure codes"
  - "Artifact generation is covered by tests that validate schema shape for both success and failure cases"
description: "Update the smoke-validation artifact generation so each run records machine-readable error codes and comparable failure metadata, enabling deterministic parity checks across operating systems."
---
