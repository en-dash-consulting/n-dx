---
"@n-dx/rex": patch
---

Stop `rex import-bundle` recommending `--replace` over deltas that are not content.

A "differing" collision is what makes the command close with "Use `--replace` to
overwrite the tree with the bundle instead", so it has to mean the item's
content differs. It did not. `sameContent` compared every field except
`children`, including the per-item bookkeeping — and that bookkeeping diverges
as a matter of course: the import stamps the local copy with the importing actor
and the time it landed, while a local `rex sync` writes `lastSyncedAt` and
`remoteId` that the bundle no longer carries at all, since export now strips
them. Re-importing a round-tripped bundle therefore reported its overlap as
content collisions and pointed the operator at the one command that can discard
the whole tree, over items nobody had changed.

Collision kind now ignores `lastModified`, `lastModifiedBy`, `lastSyncedAt` and
`remoteId`. A genuine edit is still reported as differing.

The field list is now declared once, in `sync.ts`, and shared. It had been
written out three times — twice in `sync.ts` itself, as two byte-identical sets,
and once implicitly by the bundle comparison that omitted it. `itemSignature` is
deliberately *not* reused wholesale: it folds `children` in as an id list, which
would make a parent read as differing merely because the bundle brought it a new
child, re-introducing the same spurious collision from the other direction.

The round-trip e2e test asserted the collision count but not the kind, so it
passed whether every collision was identical or differing. It now asserts the
kind.
