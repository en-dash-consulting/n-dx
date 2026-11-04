---
id: "ab81b682-f37c-4fcd-9f26-422dd376b659"
type: "task"
title: "A failing check is classed behind-base only from annotation lines or the check name"
slug: "a-failing-check-is-classed-behind-base"
description: "Review finding F1 (https://github.com/en-dash-consulting/n-dx/pull/930#discussion_r4469226230). classifyFailingCheck in packages/web/src/server/branch-health/checks.ts matches BEHIND_BASE against the whole cleaned log before the policy-test and touched-test rules, so tests/e2e/iso-skill-drift.test.js ('is out of date with packages/sourcevision/src/export/...') and a changed test named 'prefers origin/main over a local main that is behind it' come out behind-base. Take Hal's option 1: match the regex only on ##[error] annotation lines and the check name. The BEHIND merge state and the uncontained-stack fact still catch stale branches."
acceptanceCriteria:
  - "BEHIND_BASE matches only ##[error] annotation lines and the check name, never ordinary log lines (tested)"
  - "A log whose failing assertion says 'out of date with' (the iso-skill-drift message) is not classed behind-base (tested)"
  - "A changed test file whose failing test name says 'is behind' is classed touched-test (tested)"
  - "The existing behind-base cases (a ##[error] annotation, the BEHIND merge state, an uncontained stack layer) still class behind-base (existing tests pass)"
priority: "medium"
---
