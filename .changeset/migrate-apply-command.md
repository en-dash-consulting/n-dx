---
"@n-dx/rex": patch
"@n-dx/core": patch
---

`rex migrate-apply --plan=<path.json> [--dry-run]` applies a reviewed `rex migrate-plan` plan: it writes the v2 product and change layers and removes the v1 tree in one PRD transaction, or with `--dry-run` rehearses and writes nothing. `ndx migrate --apply [--plan=<path>] [--dry-run]` runs it, reading `./migration-plan.json` by default, where `ndx migrate --plan` writes.
