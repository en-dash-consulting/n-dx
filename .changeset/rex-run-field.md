---
"@n-dx/rex": patch
"@n-dx/web": patch
---

PRD items can carry a `run` block of saved run settings (model, provider, permission mode, review, review model, review optional, skip test gate, max turns, token budget, context notes). It round-trips through the folder tree, an empty block is never written, and rex exports `validateRunSettings` so every writer applies the same rules. A hand-edited malformed block no longer stops the PRD loading, but writes are refused until it is fixed. Nothing reads the block yet.
