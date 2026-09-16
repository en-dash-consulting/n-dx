---
"@n-dx/rex": patch
---

PRD lock release now deletes only on positive proof of ownership. It previously
unlinked the lock whenever its content failed to decode, which would remove a
replacement lock published by a build whose lock shape this one cannot parse —
an unlink of a live foreign holder, from the one code path in the module that
still deletes a lock it had not verified as its own. Undecodable content is
absence of evidence, not evidence of ownership, so such a lock is now left in
place for the same manual cleanup every other unowned lock gets.
