# Rex E2E Test Coverage Inventory

## Covered Commands

Commands with dedicated e2e test files:

| Command | Test file | Notes |
|---------|-----------|-------|
| analyze | cli-analyze.test.ts | Full pipeline test |
| import | cli-import.test.ts | File import scenarios |
| prune | cli-prune.test.ts | Smart prune with proposals |
| init | cli-init.test.ts | Directory setup |
| fix | cli-fix.test.ts | PRD fix operations |
| smart-add | cli-smart-add.test.ts | Duplicate-aware add |
| sync | cli-sync.test.ts | Remote sync adapter |
| adapter | cli-adapter.test.ts | Adapter structural test |
| workflow | cli-workflow.test.ts | Workflow transitions |
| quiet | cli-quiet.test.ts | Quiet mode output |
| recommend | cli-recommend.test.ts | Recommendation pipeline |

## Intentionally Deferred

Commands not yet covered by e2e tests. These are lower-risk because they
are either thin wrappers around well-tested core functions or have unit test
coverage at the core level.

### CRUD commands (thin wrappers around PRDStore)

| Command | File | Reason deferred |
|---------|------|-----------------|
| add | add.ts | Thin wrapper; core store logic has unit coverage |
| remove | remove.ts | Thin wrapper; core store logic has unit coverage |
| update | update.ts | Thin wrapper; core store logic has unit coverage |
| move | move.ts | Thin wrapper; core store logic has unit coverage |

### Query / display commands

| Command | File | Reason deferred |
|---------|------|-----------------|
| status | status.ts | Display-only; relies on well-tested tree utilities |
| next | next.ts | Display-only; task selection has unit coverage |
| validate | validate.ts | Validation logic has unit coverage in core |
| health | health.ts | Read-only health reporting |
| report | report.ts | Read-only report generation |
| usage | usage.ts | Token usage display |
| verify | verify.ts | Criteria verification; core logic unit-tested |

### Review / restructuring commands

| Command | File | Reason deferred |
|---------|------|-----------------|
| chunked-review | chunked-review.ts | LLM-dependent review pipeline |
| decomposition-review | decomposition-review.ts | LLM-dependent review pipeline |
| reshape | reshape.ts | Structural refactoring of PRD items |
| reorganize | reorganize.ts | PRD tree reorganization |
| validate-interactive | validate-interactive.ts | Interactive variant of validate |

### Support modules (not standalone commands)

| File | Purpose |
|------|---------|
| constants.ts | Shared CLI constants |
| chunked-review-state.ts | State management for chunked-review |
| format-loe.ts | Level-of-effort formatting helper |
| smart-add-duplicates.ts | Duplicate detection for smart-add |
| status-sections.ts | Status output section formatting |
| status-shared.ts | Shared status utilities |
| token-format.ts | Token count formatting |
| ZONE_BOUNDARY.md | Zone boundary documentation |

## Coverage Policy

Zone-level cohesion metrics show perfect scores for rex-cli-e2e, but this
reflects internal test structure — not command coverage breadth. This
inventory exists to make the coverage gap visible without relying solely
on zone metrics.
