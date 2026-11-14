---
"@n-dx/hench": patch
---

`hench.testGate.maxWorkers` caps the test workers of every test command a run starts, passed as `NDX_TEST_MAX_WORKERS`.

It reaches the test gate and its re-run, the post-task tests, the completion test run and the agent's shell. It is unset by default, which changes nothing. A lower `NDX_TEST_MAX_WORKERS` already in the environment wins, so the setting can lower a cap you exported but never raise it. Set it with `ndx config hench.testGate.maxWorkers 2 .`; it only takes effect in a project whose vitest configs read `NDX_TEST_MAX_WORKERS`. An invalid value is refused.
