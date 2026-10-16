---
"@n-dx/rex": patch
---

`rex migrate-apply` and its `--dry-run` print the v2 rule findings on the migrated tree, counted by rule (errors and warnings), as `rex health` then reports them. They are reported, not refused. A test now pins apply's refusal when the tree reads back without a v1 id.
