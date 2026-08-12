---
id: "d7f5ba08-a413-44f2-a560-0423be6b4413"
level: "feature"
title: "Surface all new functions as dashboard pages/sections"
status: "pending"
priority: "high"
tags:
  - "web"
  - "ui"
  - "coverage"
source: "ndx-capture"
acceptanceCriteria:
  - "A documented audit inventory lists every backend/CLI/MCP function without UI coverage"
  - "Each uncovered function gains a dashboard page or section, or a documented exclusion with rationale"
  - "All new pages/sections are reachable from the dashboard navigation"
  - "No regressions in existing dashboard views (build, typecheck, and web tests pass)"
description: "The dashboard UI lags behind the toolkit's actual capabilities: functions/commands that exist in the packages (rex, sourcevision, hench, core orchestration) have no page or section in the web UI, so the product is not fully usable from the dashboard. Audit every function/command/capability that lacks UI representation, then add dashboard pages or sections so each one can be used and applied from the UI."
---

## Children

| Title | Status |
|-------|--------|
| [Implement new dashboard pages/sections for uncovered functions](./implement-new-dashboard-pages-974800/index.md) | in_progress |
| [Audit functions lacking dashboard UI coverage](./audit-functions-lacking-15afda.md) | completed |
