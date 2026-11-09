---
id: "6ded6a40-3201-4a0f-ba10-7c3653cbeddb"
type: "change"
title: "Branch health: fixes from Hal's review of #930"
slug: "branch-health-fixes-from-hal-s-review"
intent: "Fixes for the five findings in Hal's adversarial review of R2 (https://github.com/en-dash-consulting/n-dx/pull/930#pullrequestreview-5770574908), each confirmed against 5d36cf4b5, in packages/web/src/server/branch-health/. F1 the behind-base regex runs over the whole failed log, so a failing test whose text says 'out of date with' is classed behind-base (checks.ts). F2 when gh fails, the cached PR base is skipped and the strip silently compares against the default branch (collect.ts). F3 opening the Workspaces board runs a git diff per other worktree per card, O(worktrees squared), with no cache (collect.ts). F4 allowlist-union lists an entry twice when both sides added it (conflicts.ts). F5 a merge-tree timeout is reported as needing git 2.38 (collect.ts). Hal's unraised editScript memory note is out of scope."
acceptanceCriteria:
  - "The five findings in Hal's #930 review (F1 to F5) are fixed, each with a test that reproduces it"
  - "GET /api/branch-health keeps its response shape; nothing runs a fix or writes to a worktree"
touches:
  - "81e855bf-c278-46b7-924f-d5a3c4227b22"
fix: true
priority: "medium"
discoveredFrom: {"item":"477c02f8-fba6-46ea-93ef-19fbf9293954"}
source: "pr-review"
---
