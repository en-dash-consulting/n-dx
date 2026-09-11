---
"@n-dx/core": patch
---

Fix `ndx start`'s port-occupant self/peer check so a symlinked project path
(or, on Windows, a different drive-letter/casing spelling) is recognised as
the same directory instead of a peer.

`classifyPortOccupant` compared `resolve()`d paths, which normalises
separators and `..` segments but does not resolve symlinks and does not
case-fold. A directory reached through a symlink (e.g. `ndx start ~/work`
where `~/work` links to the directory already serving 3117) therefore
compared unequal to itself, was classified as a peer, and `runWeb` relocated
to a second port instead of restarting — leaving two dashboards live against
the same `.rex/prd_tree/`. Foreground `ndx start` never writes a PID file, so
this comparison is the only thing guarding idempotent restart in that case.

Both sides are now canonicalised with `realpathSync.native` (falling back to
`resolve()` when the path no longer exists, so a deleted directory degrades
to the old lexical comparison instead of throwing).
