---
id: "0886fe61-3205-466f-a0ee-a3c098622fc1"
level: "task"
title: "Refactor smoke parity checks to compare normalized error codes"
status: "completed"
priority: "critical"
tags:
  - "ci"
  - "cross-platform"
  - "validation"
  - "smoke-tests"
source: "smart-add"
startedAt: "2026-04-07T22:50:06.438Z"
completedAt: "2026-04-07T22:54:06.485Z"
acceptanceCriteria:
  - "CI parity checks fail when normalized error codes differ for the same smoke scenario"
  - "CI parity checks ignore expected OS-specific variations such as file paths, shell wording, and native process messages"
  - "Parity output clearly reports code mismatches with the corresponding scenario name"
  - "Existing macOS and Windows smoke jobs continue to run under the updated comparison flow"
description: "Replace direct artifact content comparison with parity logic that validates equivalent error codes and other OS-neutral fields, avoiding false mismatches caused by expected platform-specific output differences."
---
