---
id: "8230a96e-0108-494d-879b-4a76f7ee4360"
level: "feature"
title: "Stabilize web server route tests under parallel suite load"
status: "pending"
priority: "medium"
acceptanceCriteria: []
description: "routes-hench-audit (terminate 404 test got 200) and routes-hench-execute (404 test got 401) each failed once during full-suite runs while passing consistently in isolation (5/5, 3/3). Suspected shared module-level state (activeExecutions) or port/env sensitivity under vitest worker load. Diagnose and make these tests deterministic."
---
