---
"@n-dx/core": patch
---

Two `ndx start` run at once against an older hub now both succeed; the second joins the hub the first started instead of failing to register.

Each `ndx start` checks the hub in several steps. When the other command stopped the old hub between two of them, `hub.pid` still named the stopped hub until the new one recorded itself, and the check read that as a hub not identified as this user's. The command then said the hub "was left running because it could not be identified as this user's hub (the recorded hub … is not running)" and failed with `Registering with the n-dx hub failed (unreachable)`. It now waits for the port to come free or for the other command's hub to answer, and judges the hub there again. Nothing is sent to the port until a listener there is identified as this user's hub.

When both commands start a hub at the same moment, the one whose hub loses the port now keeps waiting for the winner to answer and joins it. Before, it gave up as soon as its own hub exited, if the winner had not yet recorded its pid.
