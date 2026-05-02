---
id: "47b55bf8-f68b-48c0-b7bb-c469ff552436"
level: "task"
title: "Document error code meanings and remediation expectations"
status: "completed"
priority: "high"
tags:
  - "docs"
  - "diagnostics"
  - "ci"
  - "developer-experience"
source: "smart-add"
startedAt: "2026-04-07T22:54:09.031Z"
completedAt: "2026-04-07T22:58:12.661Z"
acceptanceCriteria:
  - "Documentation lists each exported cross-platform error code with its failure meaning"
  - "The docs explain which artifact fields are parity-critical versus OS-specific"
  - "Contributor guidance describes how to assign a code for newly introduced comparable failures"
  - "CI or test coverage fails if a newly emitted comparable error code is missing from the reference list"
description: "Provide a maintained reference for the new error codes so engineers can interpret smoke failures quickly and understand which issues are intended to compare across platforms."
---
