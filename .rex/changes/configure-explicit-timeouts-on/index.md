---
id: "55d8280d-4b05-4109-99da-f803b8330b1a"
type: "change"
title: "Configure explicit timeouts on identified hanging-test candidates"
slug: "configure-explicit-timeouts-on"
intent: "Apply explicit timeout settings to every at-risk test or suite so that hangs fail within a bounded window of 120 seconds or less."
acceptanceCriteria:
  - "Every identified at-risk test or suite has an explicit timeout configured at or below 120 seconds"
  - "Timeout configuration changes are limited to test files or test-only setup files"
touches:
  - "0fb7be48-74a2-495d-a184-dced4d6d2d87"
priority: "critical"
tags:
  - "tests"
  - "timeouts"
  - "vitest"
  - "stability"
source: "smart-add"
---
