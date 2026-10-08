---
"@n-dx/rex": patch
"@n-dx/llm-client": patch
---

Rex can re-point recorded commit SHAs that a rebase, cherry-pick or squash rewrote to the commit they became on main (same author date and subject, patch-id, or N-DX-Item trailer and subject, then an optional host pull-request lookup), returning unmatched SHAs with a reason. `exec` gains an `input` option that writes to the child's stdin.
