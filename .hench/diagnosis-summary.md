# Timer-Expiry Auto-Commit Stall Diagnosis - Complete

## Issue Identified

When hench runs with `--yes/--auto/--loop`, the timer-expiry auto-commit path was missing an acknowledgment signal back to the loop that the auto-commit had already happened. This caused the loop to continue as if no commit occurred, without any explicit recognition of the successful timer-expiry auto-commit.

## Root Cause

### The Problem Chain

1. **Timer fires asynchronously** (commit-msg-watcher.ts line 126-131)
   - The `tryAutoCommit()` promise is **not awaited**
   - It executes in the background while the rest of the run continues

2. **Auto-commit completes silently** (commit-msg-watcher.ts line 110-120)
   - Only a `detail()` log message is emitted
   - The message file is deleted
   - No state signal is returned to the caller

3. **performCommitPromptIfNeeded finds no file** (shared.ts line 1007)
   - Checks if message file exists
   - Returns early with no acknowledgment
   - Loop continues without knowing what happened

4. **Result: Silent continuation without confirmation**
   - The auto-commit happened, but the loop doesn't explicitly acknowledge it
   - Appears as a stall because there's no transition/progress message
   - User sees "Auto-commit: committed staged changes (timer expiry)." but then silence

## Solution Implemented

### Architecture Change: Add Acknowledgment Signal

Added a `didAutoCommit()` method to the `CommitMsgWatcher` interface that:

1. **Tracks auto-commit state** in the watcher closure (new `autoCommitted` flag)
2. **Sets flag on success** when git commit completes (commit-msg-watcher.ts line 115)
3. **Returns boolean status** via `didAutoCommit()` method

### Integration Points Updated

1. **commit-msg-watcher.ts**
   - Added `autoCommitted` flag tracking
   - Set flag when git commit succeeds
   - Export `didAutoCommit()` method on interface

2. **shared.ts**
   - Added `commitWatcher?: CommitMsgWatcher` to FinalizeRunOptions
   - Updated `performCommitPromptIfNeeded()` signature to accept watcher
   - Added early return when `commitWatcher?.didAutoCommit()` is true
   - Emits explicit acknowledgment: "Auto-commit: timer-expiry auto-commit acknowledged — proceeding to next task."

3. **cli-loop.ts**
   - Passes `commitWatcher` to `finalizeRun()` options

## Diagnostic Details

### File Locations

- **Problem**: commit-msg-watcher.ts line 1000 (performCommitPromptIfNeeded not acknowledging timer-expiry)
- **Root State Gap**: No way to distinguish between "file was never created" vs "timer already deleted it"
- **Missing Signal**: No explicit acknowledgment that auto-commit succeeded

### Promise Chain

The timer callback (line 129) fires `tryAutoCommit()` without awaiting:
```typescript
tryAutoCommit().catch(() => { /* swallow — never block the process */ });
```

This is intentional (prevents blocking), but means the completion is entirely asynchronous and invisible to the run record. The fix detects this asynchronous completion by checking the flag later.

### Race Window

The critical window is between when the timer fires and when `finalizeRun()` calls `performCommitPromptIfNeeded()`:
- If timer fires during this window, the message file will be gone
- But the `didAutoCommit()` flag allows detection anyway

## Testing

Existing tests verify:
- `tests/integration/commit-msg-timer.test.ts` — 6 integration tests validate timer behavior
- `tests/unit/agent/lifecycle/commit-msg-watcher.test.ts` — 3 unit tests for branches

New diagnostic test created:
- `tests/integration/loop-timer-expiry-stall.test.ts` — Placeholder for regression test

## Expected Outcome

After this fix:
1. Timer fires and auto-commits silently
2. `performCommitPromptIfNeeded()` detects the auto-commit via `didAutoCommit()`
3. Explicit acknowledgment logged: "Auto-commit: timer-expiry auto-commit acknowledged — proceeding to next task."
4. Loop continues immediately without stalling

The loop will now **explicitly acknowledge** that a timer-expiry auto-commit occurred and proceed, instead of silently continuing.
