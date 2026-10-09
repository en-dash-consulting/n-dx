---
"@n-dx/rex": patch
---

The v2 rule `title-release-token` is now a warning. `rex health` still prints a title that names a project release or a PR, but it no longer counts as a tree rule error, so it cannot fail the command or `ndx ci`. `rex add`, `rex change place` and MCP `add_item` / `place_change` refuse only on errors, so they now also accept a title naming a PR (such as "PR 12 follow-up"), which they refused before. Titles naming a release were already accepted there.
