---
"@n-dx/rex": patch
---

Add `rex ready` to mark PRD items ready to work.

An item qualifies when it has at least one `automated` or `metric`
requirement — own or inherited from an ancestor — and no open blocker:
status isn't `blocked`, and every `blockedBy` id is completed. Items already
`completed`, `deferred`, `cancelled`, or `deleted` never qualify.

With no `--item`, it walks the whole tree: qualifying items get
`ready: true`, items that previously qualified but no longer do get the
field cleared, and every item worth explaining (any qualifying item, plus
any non-qualifying item that has a requirement of the right type) prints
its verdict and reason. `--item=<id>` evaluates and marks a single item.
`--format=json` prints the machine-readable form.

`ready` is written only as `true` — a non-qualifying item has the field
cleared rather than set to `false`, so its absence always means "not
currently ready" rather than a stale positive. The field is purely
informational: task selection (`rex next` / `get_next_task`) never reads
it, so a tree that has never run `rex ready` — which is every tree today —
selects exactly as it always has.

Fixed a latent round-trip bug in the folder-tree serializer found while
adding this: boolean frontmatter fields were always quoted
(`JSON.stringify(String(value))`), and the parser checks for a quote before
it checks for `true`/`false`, so a boolean silently came back as the
*string* `"true"` instead of the boolean. `ready` is the first `PRDItem`
field to exercise that path; booleans now emit unquoted.
