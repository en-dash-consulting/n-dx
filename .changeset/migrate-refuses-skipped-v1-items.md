---
"@n-dx/rex": patch
---

`rex migrate-plan`, `rex migrate-apply --dry-run` and `rex migrate-apply` refuse a v1 tree with an item file the parser cannot read, such as unclosed front matter left by a hand edit or a merge conflict. The refusal names each file. Before this, the store's load dropped the parser's warning, so the plan and the dry run left the item out without saying so, and apply then removed `prd_tree/` along with that item's file. The v1 parser now marks a warning `skipped` when it drops an item, as the v2 reader already did.
