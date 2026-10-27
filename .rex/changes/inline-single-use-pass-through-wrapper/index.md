---
id: "a257a82d-7d40-4bd7-92f9-f5dd73bacab5"
type: "change"
title: "Inline single-use pass-through wrapper functions in production source files"
slug: "inline-single-use-pass-through-wrapper"
intent: "Survey all production source files for functions that contain exactly one statement — a direct call to another function passing arguments through unchanged, with no conditional logic, guard clauses, or error handling added. Inline each at its call sites and delete the wrapper. Special attention to CLI command handlers that wrap a single core function call and string-manipulation helpers that wrap a single built-in. Verify build and tests pass after each inlining."
acceptanceCriteria:
  - "No production function exists whose sole body is a single delegating call to another function with no transformation"
  - "Each inlining is confirmed to preserve identical runtime behavior via test suite"
  - "pnpm build and pnpm test pass after every inlining step"
  - "Net line reduction is at least 60 lines"
touches:
  - "4f6b9dca-d9bb-4ca4-bc5e-ea33ffdde17d"
priority: "medium"
tags:
  - "refactor"
  - "simplification"
  - "cleanup"
source: "smart-add"
---
