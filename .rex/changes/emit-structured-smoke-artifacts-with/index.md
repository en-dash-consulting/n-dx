---
id: "b714bd5d-c003-423e-a367-e759ae74eba1"
type: "change"
title: "Emit structured smoke artifacts with normalized error codes"
slug: "emit-structured-smoke-artifacts-with"
intent: "Update the smoke-validation artifact generation so each run records machine-readable error codes and comparable failure metadata, enabling deterministic parity checks across operating systems."
acceptanceCriteria:
  - "Smoke artifacts include normalized error code fields for failed command executions"
  - "Artifact schema distinguishes error code from platform-specific stderr or path details"
  - "Successful runs continue to emit artifacts without introducing placeholder failure codes"
  - "Artifact generation is covered by tests that validate schema shape for both success and failure cases"
touches:
  - "08464700-9955-4338-87b6-afea0646a6f8"
priority: "critical"
tags:
  - "ci"
  - "artifacts"
  - "cross-platform"
  - "testing"
source: "smart-add"
---
