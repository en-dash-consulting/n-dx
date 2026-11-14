---
"@n-dx/hench": patch
---

A failing machine-id lookup no longer delays each sandboxed command, or fails a test run started inside another run's validation slot.

Hench now reads the slot directory on the host and passes it as `NDX_VALIDATION_SLOT_DIR` (the directory only, no token) to every command it confines: `run_command`, `git`, its own validation commands and the vendor CLI session. An absolute `NDX_VALIDATION_SLOT_DIR` is the slot directory for hench and for `scripts/run-all-tests.mjs`, with or without a token, so a run handed one does no lookup of its own. A transient lookup failure is remembered for 60 s instead of being retried by every caller, and the stale-holder check before each confined spawn never waits on a lookup: until the host's identity is known, it skips that spawn's check.

The vendor CLI session, Codex's included, waits for the lookup when it is still running, up to the 10 s lookup limit, and Ctrl-C stops the wait, so a session started early no longer runs without the directory for its whole life. If the lookup fails, the session starts without it and one warning says so.
