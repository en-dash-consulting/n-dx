---
"@n-dx/core": patch
---

`ndx start --here` restarts this directory's own token-protected server when its PID file is gone, instead of starting a second dashboard beside it. The server is identified by its owner and command line; no probe sends the token.
