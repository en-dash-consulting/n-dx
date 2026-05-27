# Timer-Expiry Auto-Commit Stall Diagnosis

## Issue Summary
When hench runs with `--yes/--auto/--loop`, a timer-expiry auto-commit can stall the loop instead of advancing to the next task. The message logged is:
```
Auto-commit: committed staged changes (timer expiry).
```

## Code Flow Analysis

### 1. Watcher Setup (cli-loop.ts:1201)
```typescript
const commitWatcher: CommitMsgWatcher = startCommitMsgWatcher({ projectDir, timeoutMs: commitMsgTimeoutMs });
```

### 2. Timer Callback (commit-msg-watcher.ts:126-131)
```typescript
timer = setTimeout(() => {
  timer = undefined;
  if (!cancelled) {
    tryAutoCommit().catch(() => { /* swallow — never block the process */ });
  }
}, timeoutMs);
```

**KEY INSIGHT:** The `tryAutoCommit()` promise is **NOT AWAITED**. It's fired and the .catch() swallows errors. This is intentional per the comment.

### 3. tryAutoCommit() Function (commit-msg-watcher.ts:84-121)
```typescript
async function tryAutoCommit(): Promise<void> {
  if (cancelled) return;
  // ... file checks ...
  try {
    await execStdout("git", ["commit", "-F", PENDING_COMMIT_FILE], {
      cwd: projectDir,
      timeout: 30_000,
    });
    detail("Auto-commit: committed staged changes (timer expiry).");
  } catch (err) {
    detail(`Auto-commit failed: ${(err as Error).message}`);
  } finally {
    try { unlinkSync(msgPath); } catch { /* ignore */ }
  }
}
```

**CRITICAL POINT:** This function **awaits** the git commit (30s timeout max), then logs the detail message. The promise is **not awaited by the caller**, so it executes asynchronously in the background.

### 4. Watcher Cancellation (cli-loop.ts:1374)
```typescript
commitWatcher.cancel();
```

This happens **before** `finalizeRun()` is called. When called, it:
- Sets `cancelled = true`
- Clears the pending timer (if not yet fired)
- Closes the watcher

**RACE CONDITION WINDOW:** If the timer fires **between** lines 1128-1130 (inside the setTimeout callback), the tryAutoCommit() promise might be:
- Still awaiting the git commit
- Already logging the detail message
- Already cleaning up the file

### 5. performCommitPromptIfNeeded (shared.ts:985-1156)
```typescript
export async function performCommitPromptIfNeeded(
  run: RunRecord,
  projectDir: string,
  autoCommit: boolean,
  yes?: boolean,
  autonomous?: boolean,
  store?: PRDStore,
  taskId?: string,
): Promise<void> {
  if (autoCommit || run.status !== "completed") return;  // Line 994
  
  // ... later ...
  
  if (!existsSync(msgPath)) return;  // Line 1000
  
  let message = "";
  try {
    message = readFileSync(msgPath, "utf-8").trim();  // Line 1004
  } catch {
    return;
  }
  
  if (!message) {
    try { unlinkSync(msgPath); } catch { /* ignore */ }
    return;
  }
  
  const stagedCount = await countStagedFiles(projectDir);  // Line 1013
  // ... commit prompt flow ...
}
```

## Potential Stall Scenarios

### Scenario A: Promise Never Resolves
If `tryAutoCommit()` is still waiting for the git commit when the timer is cancelled:
1. Timer fires and calls `tryAutoCommit()`
2. `tryAutoCommit()` starts awaiting `execStdout("git commit ...")`
3. `cancel()` is called, setting `cancelled = true`
4. But `tryAutoCommit()` is still awaiting the git commit
5. Git commit takes time (or hangs)
6. Eventually completes or times out at 30s
7. The .catch() handler fires, but nobody is waiting for it

**Impact:** The loop doesn't stall directly - `tryAutoCommit()` will complete eventually.

### Scenario B: File Deletion Race
1. Timer fires and starts `tryAutoCommit()`
2. `tryAutoCommit()` starts awaiting git commit
3. While git commit is running, `performCommitPromptIfNeeded` is called
4. At line 1000, the file exists (git commit hasn't finished deleting it)
5. At line 1004, tries to read the file
6. Meanwhile, `tryAutoCommit()` finishes git commit and deletes the file
7. File read fails (returns empty message?)

**Impact:** Could cause unexpected behavior but shouldn't stall.

### Scenario C: Missing Acknowledgment
1. Timer fires and auto-commits
2. `performCommitPromptIfNeeded` is called
3. File doesn't exist (timer deleted it)
4. Function returns early at line 1000
5. No log message confirming the auto-commit was detected
6. The loop continues as normal

**This is the most likely scenario:** The loop doesn't actually stall; instead, it just silently continues without acknowledging that the timer-expiry auto-commit happened. The test/user just doesn't see confirmation.

## Required Diagnostic Information

To identify the exact stall:

1. **Where does execution block?**
   - Exact file and line number
   - Is it an await, a prompt, or a state check?

2. **What condition triggers it?**
   - Timer must fire during what window?
   - Before git commit finishes? After?
   - Before performCommitPromptIfNeeded? After?

3. **What's the blocking call?**
   - Is it `execStdout` in tryAutoCommit?
   - Is it `promptCommitConfirm` in performCommitPromptIfNeeded?
   - Is it an unhandled promise?
   - Is it a file I/O operation?

## Hypotheses to Test

1. **Hypothesis: tryAutoCommit promise never settles**
   - The .catch() handler is never called
   - But why would execStdout not complete?

2. **Hypothesis: performCommitPromptIfNeeded waits for a prompt that never comes**
   - Line 1031: `confirmed = await promptCommitConfirm(stagedCount)`
   - But in --loop mode with --yes and autonomous, isInteractive is false
   - So no prompt should be waiting

3. **Hypothesis: Race condition during file operations**
   - Timer deletes file while performCommitPromptIfNeeded is reading it
   - readFileSync throws error that's not caught
   - Causes a stall somewhere upstream

4. **Hypothesis: No stall at all - just missing acknowledgment**
   - The loop continues normally
   - But there's no log message confirming timer-expiry auto-commit was processed
   - User sees the auto-commit happen, but then doesn't see the next task start immediately
   - Appears as a stall when it's actually just silent continuation
