---
"@n-dx/llm-client": patch
---

`exec` no longer reports a timeout while the process tree is still alive.

The timeout path already awaited the tree kill before resolving, but the `close` handler resolved too — and `close` fires when the DIRECT child's pipes close, which with `shell: true` is the moment the shell dies, not the moment its descendants do. Since `finish()` is idempotent, `close` won the race and the awaited path was effectively dead code (its own comment assumed as much). Callers therefore resumed against a live tree still holding the cwd and any port it had bound.

On Windows that surfaced as `EBUSY: resource busy or locked, rmdir` when a test tore down its workspace immediately after a timeout — hench's `tests/unit/tools/shell.test.ts`, on a CI runner slow enough for `taskkill /T` to still be running. Everywhere else it was silent: a leaked process nobody attributed to the timeout.

`close` now defers to the timeout path when our own timer fired, so the promise settles only after termination completes. An externally delivered signal is not ours to wait on and still reports immediately. The timeout path was also hardened to settle even if the kill itself throws — previously a rejected kill left nothing to resolve the promise, which only went unnoticed because `close` was resolving first.

Note the trade: a timed-out `exec` now takes as long as the tree kill needs (bounded by `forceKillTimeoutMs`) before it returns. That is the point — the previous latency was borrowed against correctness.
