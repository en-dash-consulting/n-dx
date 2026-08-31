---
"@n-dx/core": patch
---

Stop `ndx` aborting with a libuv assertion instead of exiting

On Windows a command could die with

```
Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94
```

rather than exiting. Reproduced deliberately at **390 aborts in 448** concurrent
`ndx config` spawns under CPU load; the same harness with the update check
disabled produced zero, which pinned the source.

`flushAndExit` ended with `process.exit()`, which does not unwind the event loop
— it tears it down where it stands. The background update check puts a `fetch`
in flight, and behind it a DNS lookup on libuv's threadpool. When the 500 ms
race lost, that work was abandoned rather than stopped, and the completing
threadpool worker called `uv_async_send` on an already-closing handle.

Three corrections, in the order they matter:

- **Exit by letting the loop drain** instead of calling `process.exit()`. An
  unref'd 2 s fallback still forces the exit if some other handle hangs, so the
  "never hang" guarantee is kept; being unref'd it never keeps the process alive
  on its own.
- **The update check is now cancellable** and is cancelled and awaited on the
  way out, so exit is prompt rather than waiting out the request. Necessary but
  not sufficient on its own: `uv_getaddrinfo` cannot be cancelled once queued,
  and with only the abort in place the abort rate was still 385/448.
- **The race timer is cleared**, so no 500 ms timer outlives the race that
  created it. A cancelled check also no longer writes its cache, which was one
  more piece of threadpool work inside the teardown window.

Verified at 640 concurrent spawns under the same load with zero aborts, and
ordinary exits are unaffected — correct exit codes, no added latency.
