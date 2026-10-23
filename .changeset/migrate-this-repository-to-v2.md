---
"@n-dx/rex": patch
---

n-dx now tracks its own work on the v2 PRD: the repository's `.rex/` holds the product layer (areas, capabilities, constraints) and the change layer instead of the v1 `prd_tree/`, migrated with `ndx migrate --plan` and `--apply`. Nothing changes for projects that use n-dx; this is the migration the 0.10.0 release ships, run on n-dx itself first.
