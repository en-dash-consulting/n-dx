---
"@n-dx/web": patch
---

A project server hosting the hub session no longer gives up its host lock on shutdown while a hub turn is still writing the session: it refuses new hub requests, interrupts the turn and releases the lock once the turn settles (at most 5 s, else the next host takes over after exit).
