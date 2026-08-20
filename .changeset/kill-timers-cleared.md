---
"@n-dx/llm-client": patch
"@n-dx/core": patch
---

Clear the losing timer in every bounded termination wait, so a CLI exits when its work is done.

`Promise.race([waitForChildExit(child), delay(forceKillTimeoutMs)])` reads as "wait, but not forever". It also leaks: when the child wins the race, the `delay` timer is still armed, and an armed timer holds the event loop open. Nothing was waiting on it — the process simply could not exit until it fired.

Measured against `sh -c "sleep 30"` with a 300 ms command timeout, before and after, no other change:

| | `exec()` resolves | process exits | dead time |
|---|---|---|---|
| before | 432 ms | 5436 ms | ~5000 ms |
| after | 445 ms | 446 ms | ~1 ms |

The 5 s is `DEFAULT_FORCE_KILL_TIMEOUT_MS`. Any CLI that finished immediately after a command timeout sat idle for the full kill grace period before returning to the shell.

Nine sites across the two twins, all of them replaced with a `raceWithTimeout` helper that clears its own timer in a `finally`:

- `packages/llm-client/src/process-tree.ts` — four `waitForChildExit` races, the `taskkill` completion race, and `captureStdout`'s bare `setTimeout(finish, timeoutMs)`. That last one is the worst of the set: it is reached on every POSIX non-freeze kill via `posixDescendants` → `readProcessTable`, where `ps` returns in milliseconds but the timer is armed for the whole grace period.
- `packages/core/child-lifecycle.js` — the `childTarget` wait adapter and both Windows tree-kill races. Same defect, and it had to be fixed twice because the orchestration tier cannot import `@n-dx/llm-client` (spawn-only rule).

The polling `delay()` calls are deliberately untouched. Those are awaited directly rather than raced, so their timer always fires and never outlives its await — replacing them would add a `clearTimeout` that can never run.

No behavioural change to the kill sequence itself: the same signals go out in the same order with the same bounds, and every existing termination test passes unmodified. What changes is only how long the process lingers afterwards.
