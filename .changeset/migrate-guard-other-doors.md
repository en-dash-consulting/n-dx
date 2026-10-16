---
"@n-dx/core": patch
"@n-dx/rex": patch
---

`rex migrate-plan`, `rex migrate-apply` and `ndx migrate-layout` refuse inside an agent run (`NDX_AGENT_RUN` set), as `ndx migrate` already does.
