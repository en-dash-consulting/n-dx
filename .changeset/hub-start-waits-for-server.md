---
"@n-dx/core": patch
"@n-dx/web": patch
---

`ndx start` now waits for the project's server to come up and prints the sign-in URL, instead of exiting with "registered but its server is starting".

A hub that had just started answered registrations while it was still respawning the projects it already knew, so the first `ndx start` after a hub restart failed before printing the one-time sign-in link. The hub now finishes that spawn before answering, and `ndx start` keeps polling a server that is still starting until it is healthy or the registration timeout passes — which also covers a hub already running an older build.
