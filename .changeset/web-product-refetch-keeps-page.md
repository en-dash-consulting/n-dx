---
"@n-dx/web": patch
---

A failed refetch of the Product, capability or Changes read no longer replaces
the loaded page with an error: the last good data and an open capability page
(with its Back button) stay, with a "Could not refresh" notice above them. The
Ask panel's refine mode on a v2 project now applies rex's change-layer merge
rule when it parses a proposal, so a merge that absorbs a change carrying
amendments, or that merges tasks, is skipped with rex's reason instead of being
offered and then refused at apply. v1 is unchanged.
