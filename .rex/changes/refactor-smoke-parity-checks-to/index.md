---
id: "0886fe61-3205-466f-a0ee-a3c098622fc1"
type: "change"
title: "Refactor smoke parity checks to compare normalized error codes"
slug: "refactor-smoke-parity-checks-to"
intent: "Replace direct artifact content comparison with parity logic that validates equivalent error codes and other OS-neutral fields, avoiding false mismatches caused by expected platform-specific output differences."
acceptanceCriteria:
  - "CI parity checks fail when normalized error codes differ for the same smoke scenario"
  - "CI parity checks ignore expected OS-specific variations such as file paths, shell wording, and native process messages"
  - "Parity output clearly reports code mismatches with the corresponding scenario name"
  - "Existing macOS and Windows smoke jobs continue to run under the updated comparison flow"
touches:
  - "4ee969d6-cb9e-41c1-85ac-f79b3b6a6ac3"
priority: "critical"
tags:
  - "ci"
  - "cross-platform"
  - "validation"
  - "smoke-tests"
source: "smart-add"
---
