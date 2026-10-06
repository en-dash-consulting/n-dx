---
"@n-dx/hench": patch
"@n-dx/web": patch
---

Offer `promptAgentToMarkInProgress` and `git.commitMessage` from `hench config`
too.

Both keys reached hench's schema, the dashboard's config view and `ndx config`'s
help text, but never hench's own `CONFIG_FIELDS` — so the one surface an
operator reaches from the terminal could neither show nor set them, and the
cross-package contract test caught the three lists disagreeing.

`promptAgentToMarkInProgress` now carries its default in the schema rather than
only at the prompt-building use site, so a parsed config states the value the
dashboard marks against. The `git.*` rows record no default: the group is absent
from `DEFAULT_HENCH_CONFIG()`, so hench applies those at the use site and no
value inside it survives a parse of the defaults.
