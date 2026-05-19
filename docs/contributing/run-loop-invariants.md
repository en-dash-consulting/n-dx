# Hench Run-Loop Invariants

The multi-iteration hench run loop enforces three invariants that prevent task-repetition waste and ensure correct completion tracking. This document is the authoritative reference for contributors modifying loop logic. It also serves as the source content for the `.claude/skills/run-loop-invariants/SKILL.md` assistant skill.

**Key files:**
- `packages/hench/src/cli/commands/run.ts` — outer loop, attempt tracking, exclusion sets
- `packages/hench/src/agent/lifecycle/shared.ts` — status transitions, `finalizeRun`, `handleRunFailure`
- `packages/hench/src/agent/planning/brief.ts` — task selection, `excludeTaskIds` forwarding
- `packages/hench/src/prd/rex-gateway.ts` — `collectCompletedIds`, `findNextTask`

---

## Invariant 1 — Never re-pick a completed task

**Rule:** A task whose PRD status is `completed` must never be selected as the next task in any iteration of the run loop, regardless of how it reached that status (agent, MCP write, manual edit).

**Enforcement:** `collectCompletedIds()` is called before each `runOne()` invocation (inside `runIterations()` and `runLoop()` via `loadStuckTaskIds` + `combinedExcludedIds`, and inside `peekNextTaskPriority`). The resulting ID set is merged into `combinedExcludedIds` and forwarded to `assembleTaskBrief()` → `findNextTask()`, which skips any ID in the exclusion set.

**Correct:**
```
Iteration 1 → selects task-A (pending) → runs → task-A → completed
Iteration 2 → collectCompletedIds() returns {task-A}
             combinedExcludedIds = {task-A, ...stuck}
             findNextTask() skips task-A → selects task-B ✓
```

**Incorrect (violates invariant):**
```
Iteration 1 → selects task-A (pending) → runs → task-A → completed
Iteration 2 → selects task-A again  ← BUG
```

**Code paths:**
- `run.ts` `runIterations()` ~line 1182: `combinedExcludedIds = stuckIds ∪ forcedExclusionIds`
- `run.ts` `runLoop()` ~line 1319: same pattern
- `run.ts` `peekNextTaskPriority()` ~line 450: merges `completedIds` with `excludeTaskIds`
- `brief.ts` `assembleTaskBrief()`: passes `excludeTaskIds` → `findNextTask()`
- `rex-gateway.ts` `collectCompletedIds()`, `findNextTask()`

---

## Invariant 2 — Force advancement at three attempts

**Rule:** If the run loop selects the same task ID on three separate iterations within a single `ndx run` invocation, the task must be excluded from all subsequent iterations of that invocation. Threshold: `MAX_TASK_ATTEMPTS = 3` (`run.ts:47`).

**Enforcement:** `createAttemptTracker()` (`run.ts:53`) returns a per-invocation tracker backed by a `Map<taskId, count>`. After each `runOne()` returns, `attemptTracker.incrementAndGetCount(selectedTaskId)` is called. When the count reaches 3, the task ID is added to `forcedExclusionIds` and a warning is emitted: `"Forced advancement: task has reached 3 attempts in this run."` Both `runIterations()` and `runLoop()` implement this pattern.

**Correct:**
```
Iteration 1 → task-X selected (attempt 1/3) → fails, completion rejected
Iteration 2 → task-X selected (attempt 2/3) → fails
Iteration 3 → task-X selected (attempt 3/3) → fails
              attemptCount == 3 → forcedExclusionIds.add("task-X") → warn
Iteration 4 → task-X in combinedExcludedIds → selects task-Y ✓
```

**Incorrect (violates invariant):**
```
Iteration 4 → selects task-X again  ← BUG: no 3-attempt cap enforced
```

**Code paths:**
- `run.ts:38–70` — `AttemptTracker` interface and `createAttemptTracker()` factory
- `run.ts:47` — `MAX_TASK_ATTEMPTS = 3` constant
- `run.ts` `runIterations()` lines ~1206–1213: `incrementAndGetCount` + `forcedExclusionIds.add`
- `run.ts` `runLoop()` lines ~1352–1358: same pattern, with `colorWarn` log

---

## Invariant 3 — Status transition before next task selection

**Rule:** By the time the next iteration's task selection begins, the PRD status of the just-worked task must already reflect the run outcome (`completed`, `pending`, or `deferred`). The subsequent `collectCompletedIds()` call must see the updated status.

**Enforcement:** `finalizeRun()` (called at the end of both `cliLoop` and `agentLoop`) calls either `performCommitPromptIfNeeded()` → `updateCompletedTaskStatus()` on success, or `handleRunFailure()` on failure. Both call `toolRexUpdateStatus()` synchronously before returning. Since `runOne()` awaits the loop result, the PRD write completes before the outer loop's next `collectCompletedIds()` call.

**Correct:**
```
runOne() awaits cliLoop/agentLoop() {
  finalizeRun() {
    updateCompletedTaskStatus() → toolRexUpdateStatus(taskId, "completed")  ← writes here
  }
}
// runOne() returns
// Next iteration:
collectCompletedIds()  ← reads "completed" ✓
```

**Incorrect (violates invariant):**
```
// If PRD write were deferred to after runOne():
runOne() → returns
collectCompletedIds()  ← still reads "in_progress" → re-picks task  ← BUG
toolRexUpdateStatus(taskId, "completed")  ← too late
```

**Code paths:**
- `shared.ts` `finalizeRun()`: calls `performCommitPromptIfNeeded()` on `run.status === "completed"`
- `shared.ts:921` `updateCompletedTaskStatus()`: writes `"completed"` to PRD before returning
- `shared.ts` `handleRunFailure()`: writes `"pending"` or `"deferred"` on failure/timeout
- `shared.ts:290` `transitionToInProgress()`: writes `"in_progress"` at run start (idempotent)

---

## Regression checklist

Before merging changes to the files listed below, verify all three invariants:

| File | Invariants at risk |
|------|-------------------|
| `run.ts` — `runIterations`, `runLoop`, `createAttemptTracker` | I1, I2 |
| `shared.ts` — `finalizeRun`, `handleRunFailure`, `updateCompletedTaskStatus` | I3 |
| `brief.ts` — `assembleTaskBrief` | I1 |
| `rex-gateway.ts` — `collectCompletedIds`, `findNextTask` | I1 |

Checklist:

1. **I1**: `collectCompletedIds()` is called before every `runOne()` and its output reaches `findNextTask()`
2. **I2**: `attemptTracker.incrementAndGetCount()` is called for every `selectedTaskId` returned by `runOne()`; tasks at count 3 enter `forcedExclusionIds`
3. **I3**: `finalizeRun()` (or an equivalent) updates PRD status before `runOne()` returns to the outer loop

Regression tests:
- `packages/hench/tests/unit/cli/commands/run.test.ts` — `AttemptTracker`, `runIterations`/`runLoop` exclusion logic
- `packages/hench/tests/unit/agent/lifecycle/shared.test.ts` — `updateCompletedTaskStatus`, `handleRunFailure`

---

## Assistant skill

This content is mirrored at `.claude/skills/run-loop-invariants/SKILL.md` for use by Claude Code assistants. If that file is absent, copy this document's content (minus this section) into that path.
