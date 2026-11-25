---
"@n-dx/hench": patch
---

`ndx work` now names the sandbox when a confined Claude CLI cannot sign in, and leaves the task pending instead of deferred.

A run whose CLI printed "Not logged in" or "Authentication failed … Invalid or expired credentials" used to end with "No recorded signal explains this run's failure." It now classifies as a vendor auth failure. When hench's sandbox confined the CLI, the verdict says the sandboxed CLI could not read its login and suggests `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`, or `NDX_SANDBOX=off`; otherwise it still says to re-authenticate. The run record carries the new `vendorCliSandbox` field the verdict reads.
