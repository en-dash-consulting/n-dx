---
"@n-dx/core": patch
"@n-dx/rex": patch
---

Remove the documentation for the tracker adapters, `ndx sync`, `rex sync`, `rex
adapter` and the `sync_with_remote` MCP tool, and stop `ndx init` ignoring
`.rex/adapters.json`.

The code went in the two changes before this one. Documentation that outlives
the feature it describes is worse than no documentation: a reader who finds
`ndx config rex.adapter notion .` in a guide has no way to tell it is a fossil
until they run it, and a command reference listing a command that no longer
exists makes the whole reference untrustworthy. A work-tracker bridge ships
later as its own package; when it does it gets its own documentation, written
against the storage model that will actually exist rather than inherited from
the adapters it replaces.

Gone from the guides: the "Using `ndx sync` for team-backed PRDs" section of
[Keeping Your PRD Alive](https://n-dx.dev/guide/change-management) along with
its two Notion team workflows, conflict-resolution rules and the external-adapter
branch of the maintenance checklist; the `ndx sync` row in the command
reference; the `sync_with_remote` row in the MCP tool tables of the MCP guide,
the rex package page and rex's own README; and the `rex sync` / `rex adapter`
examples from the rex CLI listing.

**`change-management.md` was kept rather than deleted.** The task that
scheduled this work called for the whole file. Four of its five sections —
drift detection, the four-cycle maintenance loop, archive management and the
recovery playbook — have nothing to do with trackers and nothing else documents
them; the sync material was about 15% of the page. Deleting all of it to remove
that 15% would have cost four sections of live guidance and broken the sidebar
entry plus two inbound links for no gain. The tracker content was excised
instead, which satisfies the same requirement.

Three references to files that no longer exist were corrected while they were
in reach: `rex/src/core/notion-map.ts` in the level-system reference,
`routes-integrations.ts` and `routes-notion.ts` in the zone inventory, and the
Notion and integrations sections of the Project view in the accessibility route
table. The `/notion-config` and `/integrations` redirect aliases are still
documented in the viewer architecture page, because those aliases still exist —
they point at `/project` for 0.8.0 URL compatibility.

`.rex/adapters.json` is no longer written into `.gitignore` by `ndx init`, and
is gone from the three documented copies of that template. Nothing produces the
file any more. The repository's own `.gitignore` drops the entry in the same
change, because `tests/unit/ndx-gitignore-template.test.js` requires the
template and this repository to list identical `.rex/` entries.

The dated audit tables in `docs/cli-ui-gap.md` keep their `ndx sync` row, with a
note that the command was since removed. That table records what shipped on a
given date; rewriting it would falsify the history it exists to preserve. The
current-state inventories in the same file did drop the removed rows.
