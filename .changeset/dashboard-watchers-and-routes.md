---
"@n-dx/web": patch
---

The dashboard's watchers and routes hold up.

- `ndx start` stays up when a file watcher errors. The sourcevision, rex, hench, dev-viewer and MCP schema `dist/` watchers had no `error` listener, so an error emitted after `fs.watch` returned (Windows raises EPERM when a watched directory is deleted, for example on a branch switch) crashed the server. Each now logs a warning, closes itself and is dropped; a failed rex PRD-folder watcher can be watched again.
- The rex watcher follows a PRD folder (`prd_tree/`, `product/`, `changes/`) that is deleted and recreated while `ndx start` runs, so edits inside it refresh `.rex/.cache/prd.json` again without a restart.
- `PATCH /api/rex/items/bulk` validates `updates` with the single PATCH's rules: `run`, ids, timestamps and other fields that route refuses answer 400 naming the field, and an empty title is refused, with nothing written. On a v2 project a completing bulk PATCH adds the optional `applied` and `reason` fields to an id's result when its change was held open or left unapplied under `rex.applyOn`; an applied completion stays `{id, ok: true}`. v1 is unchanged.
- A failed refetch of the Product, capability or Changes read keeps the loaded page, and an open capability page with its Back button, under a "Could not refresh" notice instead of replacing them with an error.
- The Ask panel's refine mode on a v2 project applies rex's change-layer merge rule when it parses a proposal, so a merge that absorbs a change carrying amendments, or that merges tasks, is skipped with rex's reason instead of being offered and then refused at apply.
