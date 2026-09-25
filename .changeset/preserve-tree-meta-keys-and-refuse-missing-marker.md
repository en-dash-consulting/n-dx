---
"@n-dx/rex": patch
"@n-dx/hench": patch
"@n-dx/web": patch
---

Preserve unknown `tree-meta.json` keys, and check a PRD tree that carries no slug-rule marker before writing it.

Two changes to the same fault. A rex MCP server running a build older than the
`slugRule` field saved the PRD and rewrote `.rex/tree-meta.json` from a type
that had no such field, erasing the marker. No path moved and no item changed —
the two builds shared a slug rule — but the write guard was silently disarmed
for whoever wrote next.

- **Every `tree-meta.json` write now reads the file first and carries forward
  keys it does not recognise.** This cannot repair a sidecar an older build has
  already stripped; it stops the next such loss, between this version and the
  ones after it.
- **A tree with no marker is no longer adopted *silently*.** It is still
  adopted when every path already matches the running slug rule — the save
  records the marker and prints a one-line notice naming `rex migrate-slugs` as
  the way to verify, and `rex validate` reports the same thing as a warning
  rather than an error. What changed is that adoption is now visible, and that
  it is conditional: an unmarked tree with a path this build did not write is
  refused outright, by the store guard, `rex validate`, the `ndx work` pre-run
  gate and the dashboard's Execute gate, all saying `slug rule marker missing;
  run rex migrate-slugs`.

Absence covers two states — a tree older than the guard, and one whose sidecar
a build older than the field rewrote without the marker — and nothing on disk
separates them. The path scan is not a perfect tiebreak either: it can only
recognise a rule this build can reproduce, so a tree re-slugged by a *future*
build would scan clean. That hazard is not yet reachable, because there is no
such rule to have written one; whoever adds one moves the guard back to a
refusal in the same commit.

`rex migrate-slugs` remains the way to re-derive every path rather than trust
the scan, and it now reports `slugRuleRecorded` in its JSON output — on an
already-conformant tree it renames nothing, so the counts alone read as
"nothing happened" when it was the run that recorded the marker.

**Upgrading costs nothing on a conformant repository.** The marker is new in
this release, so every existing tree arrives without one; those written by 0.5.2
and later already follow the current rule and are adopted on their next save. A
tree predating that carries paths from a superseded rule (0.5.1 suffixed every
slug with `-{id6}`; the current rule first shipped in 0.5.2), and its writes are
refused until `rex migrate-slugs` is run — `rex validate` already reported those
paths before this release, but nothing stopped a write from re-slugging them. A new project
is unaffected: an empty tree has nothing a marker could be wrong about, so a
first save proceeds and records one.
