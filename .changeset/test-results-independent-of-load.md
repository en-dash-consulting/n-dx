---
"@n-dx/sourcevision": patch
"@n-dx/web": patch
---

test: make test results independent of machine load

Tests and test configuration only. No production code changes, so published output is unaffected; these packages ship `dist` only.

- **web:** viewer tests now commit every preact render, update and unmount inside `act()`. Previously, a render outside `act()` left preact's after-paint fallback timer pending, and if it fired after jsdom teardown it threw `ReferenceError: cancelAnimationFrame is not defined`, failing a suite whose summary said every test passed. A new setup file, `tests/setup/preact-frame-leak-guard.ts`, fails any test file that still leaves that timer pending, and names the file.
- **web:** the watcher-based waits in the worktree integration tests now scale with `NDX_TEST_TIME_MULTIPLIER`, and their git fixtures are removed with retries.
- **sourcevision:** every spawn in `cli-hints.test.ts` gets a load-scaled kill budget instead of a fixed 10 seconds.
