---
id: "a257a82d-7d40-4bd7-92f9-f5dd73bacab5"
level: "task"
title: "Inline single-use pass-through wrapper functions in production source files"
status: "in_progress"
priority: "medium"
tags:
  - "refactor"
  - "simplification"
  - "cleanup"
source: "smart-add"
startedAt: "2026-05-26T02:04:26.042Z"
acceptanceCriteria:
  - "No production function exists whose sole body is a single delegating call to another function with no transformation"
  - "Each inlining is confirmed to preserve identical runtime behavior via test suite"
  - "pnpm build and pnpm test pass after every inlining step"
  - "Net line reduction is at least 60 lines"
description: "Survey all production source files for functions that contain exactly one statement — a direct call to another function passing arguments through unchanged, with no conditional logic, guard clauses, or error handling added. Inline each at its call sites and delete the wrapper. Special attention to CLI command handlers that wrap a single core function call and string-manipulation helpers that wrap a single built-in. Verify build and tests pass after each inlining."
---
