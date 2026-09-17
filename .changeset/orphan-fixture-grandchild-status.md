---
"@n-dx/core": patch
---

Surface the real grandchild launch failure in the detached process-tree test: the
fixture's shell now carries its background job's exit status (`wait` with no
operand always exits 0) and persists shell stderr, so a Node that the Windows
shell cannot start is reported as the executable error rather than a readiness
timeout. Fixture paths are absolute and `/`-separated, and the temp directory is
removed even when a fixture process survives teardown.
