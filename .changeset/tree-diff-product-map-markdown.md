---
"@n-dx/rex": patch
---

`rex tree-diff` reports the product map delta on a v2 tree: capabilities and constraints added, modified (title, statement or capability criteria) and retired, beside the change list (`map` in `--json`). `--format=markdown` renders the report as a host-neutral pull-request comment, and `--out=<file>` writes it to a file (refused inside `.rex/`). v1 diffs are unchanged.
