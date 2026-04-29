---
id: "351e9c1a-b1af-4d3e-98a6-e559afa1153f"
level: "task"
title: "Fix Run Count in Sidebar"
status: "completed"
source: "smart-add"
startedAt: "2026-02-18T07:58:39.114Z"
completedAt: "2026-02-18T07:58:39.114Z"
acceptanceCriteria: []
description: "Correct the run count display in the Hench sidebar area to show accurate execution statistics\n\n---\n\nFix completion percentage calculations to exclude deleted items from the denominator, ensuring accurate progress tracking across all Rex UI components including CLI and web dashboard\n\n---\n\nRedesign the Rex dashboard interface to improve user experience, navigation, and information hierarchy for better task management workflow with responsive design support"
---

## Subtask: Fix run count calculation and display system

**ID:** `3100ff2b-f769-4a9b-9e80-34f82c6f8b0e`
**Status:** completed
**Priority:** high

Audit, correct, and update the complete run count system including data fetching, aggregation logic, and UI display to ensure accurate real-time run counts in the Hench sidebar

**Acceptance Criteria**

- All run count calculation points are identified and documented
- Discrepancies between actual runs and displayed count are catalogued
- Root cause of incorrect count is determined
- Run count matches actual number of runs in .hench/runs/ directory
- API endpoints return correct run count data
- Count updates properly when new runs are executed
- Sidebar shows accurate run count on page load
- Count updates in real-time when new runs are executed
- Count decreases properly if runs are deleted or archived

---

## Subtask: Fix completion percentage calculations across all Rex interfaces

**ID:** `bda6e2f4-fdc8-42ab-b36f-126df8181160`
**Status:** completed
**Priority:** high

Update completion percentage calculation logic to exclude deleted items and apply the fix consistently across CLI status command, web dashboard, and all other Rex UI components

**Acceptance Criteria**

- Deleted items are excluded from total item count in percentage calculations
- Completion percentages accurately reflect progress of active items only
- CLI status command shows accurate completion percentages with corrected progress bars
- Web dashboard Rex section displays updated metrics and PRD tree visualization
- All rex UI components show consistent updated percentage calculations

---

## Subtask: Redesign Rex dashboard with improved UX and task management workflow

**ID:** `57cc9d88-0fdc-45a0-9388-0ad576923ed8`
**Status:** completed
**Priority:** medium

Create a comprehensive Rex dashboard redesign featuring improved visual hierarchy, streamlined task management workflows, and responsive design patterns for optimal experience across all devices

**Acceptance Criteria**

- Dashboard uses clear visual hierarchy with proper typography and spacing
- Key metrics and actions are prominently displayed
- Navigation between epic/feature/task levels is intuitive
- Information density is optimized for scanning and decision-making
- Task selection and status updates are streamlined
- Next actionable task is clearly highlighted
- Bulk operations are supported where appropriate
- Task context and dependencies are clearly visible
- Dashboard is fully functional on mobile devices
- Layout adapts gracefully to different screen sizes
- Touch interactions work properly on mobile

---
