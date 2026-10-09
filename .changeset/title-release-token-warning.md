---
"@n-dx/rex": patch
---

The v2 rule `title-release-token` is now a warning. `rex health` still prints a title that names a project release, but it no longer counts as a tree rule error, so it cannot fail the command or `ndx ci`. `rex add` and MCP `add_item` still accept such titles.
