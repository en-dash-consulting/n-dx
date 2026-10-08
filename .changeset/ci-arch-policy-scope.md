---
"@n-dx/core": patch
---

`ndx ci` no longer fails user projects that import `child_process`. The
architecture-policy step enforces n-dx's own spawn allowlist, so it now runs
only on the n-dx monorepo and is reported as skipped elsewhere.
