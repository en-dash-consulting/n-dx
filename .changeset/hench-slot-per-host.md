---
"@n-dx/hench": patch
---

With `hench.testGate.hostSlot` on, the validation slot is now per host: it lives in `<ndx home>/validation-slot/<host>/`, named after the lower-cased hostname.

Hosts that share one ndx home over a network filesystem no longer clear each other's slot and run their tests at the same time. A rare race between two waiters clearing a crashed holder could also let both run at once; a waiter now removes only its own reclaim lock.
