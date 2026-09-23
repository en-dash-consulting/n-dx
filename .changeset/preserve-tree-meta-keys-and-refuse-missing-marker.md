---
"@n-dx/rex": patch
"@n-dx/hench": patch
"@n-dx/web": patch
---

Preserve unknown `tree-meta.json` keys, and refuse a PRD tree that carries no slug-rule marker.

Two changes to the same fault. A rex MCP server running a build older than the
`slugRule` field saved the PRD and rewrote `.rex/tree-meta.json` from a type
that had no such field, erasing the marker. No path moved and no item changed —
the two builds shared a slug rule — but the write guard was silently disarmed
for whoever wrote next.

- **Every `tree-meta.json` write now reads the file first and carries forward
  keys it does not recognise.** This cannot repair a sidecar an older build has
  already stripped; it stops the next such loss, between this version and the
  ones after it.
- **A tree with no marker is no longer adopted silently.** `rex validate`
  reports it as an error, and the store guard, the `ndx work` pre-run gate and
  the dashboard's Execute gate all refuse with `slug rule marker missing; run
  rex migrate-slugs`. Absence used to be read as "a tree older than the guard"
  and accepted when the paths scanned clean, but a build older than the field
  produces exactly that state, and nothing on disk separates the two. A path
  scan is not a sound tiebreak either: it can only recognise a rule this build
  can reproduce, so a tree re-slugged by a *future* build scans clean and would
  have this build's marker stamped onto paths it did not write.

`rex migrate-slugs` is the fix, and it now reports `slugRuleRecorded` in its
JSON output — on an already-conformant tree it renames nothing, so the counts
alone read as "nothing happened" when it was the run that unblocked the
repository.

**Upgrading costs one `rex migrate-slugs` per repository**, once. A tree that
has never carried a marker is refused until it is run. A new project is
unaffected: an empty tree has nothing a marker could be wrong about, so a first
save proceeds and records one.
