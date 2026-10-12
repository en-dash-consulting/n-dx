---
"@n-dx/web": patch
"@n-dx/rex": patch
---

Quick Add and batch import work on a v2 PRD. A v2 tree has no levels, so
`rex add` previews one change per description — `{ preview: true, changes }` —
rather than the epic/feature/task proposals a v1 tree returns. The dashboard
read only `proposals`, so the preview came back empty and there was no way to
add a change from the dashboard at all.

The preview routes now forward `changes`, and the panel renders each change
with the placement the rules suggest and whether it lands in the Inbox.
Accepting posts to the new `POST /api/rex/smart-add-accept`, which re-runs the
same `rex add` with `--accept`: a v2 add is deterministic — a change's title is
its description's first line, with no LLM round-trip — so what is written is
what the preview named. The v1 accept path, which writes epics, features and
tasks, is not reached.

Batch import's accept path was dropping its log line and its `rex:prd-changed`
broadcast on a v2 tree, because it looked for an `added` count in output that
is a list of change rows. It now counts the rows.

`rex add --format=json` carries each placement candidate's title and display id
alongside its `target` id, as the text report already resolves them. Without it
a JSON consumer has no tree to resolve the id against, and the dashboard could
only have shown a bare id.
