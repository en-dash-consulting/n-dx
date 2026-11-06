---
"@n-dx/core": patch
---

`ndx config credentials --import` imports nothing when the credential store was not read (refused for its mode, unreadable or invalid), and names the problem and its fix, instead of replacing a stored key or helper it could not see.
