---
id: "00db9d79-324d-4b64-acb7-e65deaa43b06"
level: "feature"
title: "Align OS-specific behavior in init and regular flows"
status: "pending"
priority: "high"
tags:
  - "cross-os"
  - "windows"
  - "security"
  - "reliability"
  - "core"
  - "hench"
source: "exploration-2026-08-17"
startedAt: "2026-08-19T15:23:17.498Z"
endedAt: "2026-08-19T15:23:17.498Z"
acceptanceCriteria:
  - "No flow claims a security or lifecycle guarantee it does not deliver on the running OS"
  - "Where a platform-appropriate equivalent exists (ACLs, tree-kill, accurate memory query), it is implemented rather than silently skipped"
  - "Where no equivalent exists, the limitation is documented at the call site AND surfaced to the user where it affects their security or reliability decisions"
  - "Each of the three divergences has a test that runs on Windows"
description: "Three verified places where the same n-dx command delivers a different guarantee depending on the OS, without the difference being surfaced to the user:\n\n1. SECURITY — packages/core/config.js:115 calls `chmod(path, 0o600)` on .n-dx.json when it holds an API key. On Windows, fs.chmod cannot express POSIX modes (it toggles the read-only attribute only), so the file keeps its inherited ACLs and remains readable by other users of the machine. Meanwhile `ndx config --help` (config.js:1203) states \"File permissions set to 0600 (owner-only) for security\" unconditionally. The two tests that would catch this (cli-config.test.js:936, :955) are Windows-skipped.\n\n2. ADMISSION CONTROL — packages/hench/src/process/memory-monitor.ts:309-319 resolves available memory from /proc/meminfo MemAvailable on Linux and vm_stat on macOS, but falls back to raw os.freemem() on Windows, which excludes the standby/cached list. Identical machine state therefore yields a lower available-memory reading on Windows, biasing MemoryThrottle toward delaying or rejecting runs.\n\n3. LIFECYCLE — packages/core/web.js:169-176 and stopServer implement their own SIGTERM-then-SIGKILL sequence against a single PID, entirely bypassing child-lifecycle.js. On Windows SIGTERM maps to TerminateProcess (no graceful shutdown, so the server's cleanup handlers never run), and only the server PID is signalled, leaving its children orphaned.\n\nThe governing principle for all three: where an OS primitive has no analog, make the difference EXPLICIT — implement the platform-appropriate equivalent, or state the limitation to the user — rather than absorbing it into a fallback that keeps the code looking uniform while behaving differently."
---

## Children

| Title | Status |
|-------|--------|
| [Confirm AC 7 of the freeze-verify-kill task: a POSIX CI run must actually execute the freeze policy green](./confirm-ac-7-of-the-freeze-50f241.md) | pending |
| [Decide and document the Windows available-memory strategy for hench admission](./decide-and-document-the-windows-cd8060.md) | completed |
| [Enforce API-key file permissions on Windows via ACLs, or stop claiming they are set](./enforce-api-key-file-01d91d.md) | completed |
| [Freeze-verify-kill: make the POSIX tree kill definitive for timeouts](./freeze-verify-kill-make-the-71e448.md) | completed |
| [Guard usePanZoom against a zero-sized element, and give the hook its first test](./guard-usepanzoom-against-a-zero-40eeec.md) | completed |
| [hench's RunChangeDetector shares the mtime-granularity blind spot](./hench-s-runchangedetector-e560e5.md) | completed |
| [hench's scoped post-task test run always fails on Windows (backslash paths eaten by sh -c)](./hench-s-scoped-post-task-test-c7f341.md) | completed |
| [pair-programming.js times out with bare SIGTERM — three sites, no tree kill, no escalation, no await](./pair-programming-js-times-out-3d39c1.md) | pending |
| [Route ndx start stop through the unified terminateTree contract](./route-ndx-start-stop-through-042a5a.md) | completed |
| [Spawn exec's children through spawn so POSIX can create a real process group](./spawn-exec-s-children-through-58161d.md) | completed |
| [Tree-kill on shell-command timeout: a timed-out command keeps running and keeps writing](./tree-kill-on-shell-command-a99519.md) | completed |
