---
"@n-dx/rex": patch
---

Drop the unreachable id check from the stale-save guard, and correct the docs around it.

Putting the content-digest check ahead of the item-id check made the id check unreachable: a file that reaches it has already failed the digest, so it differs from what the snapshot read, and both branches returned the same answer. Removing it also removes the `savedIds` parameter and the `collectItemIds` walk over the whole tree, which ran on every save. The surrounding docstrings described the id as the thing distinguishing a relocation from a deletion; the digest is, and they now say so.
