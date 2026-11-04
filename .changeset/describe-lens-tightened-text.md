---
"@n-dx/web": patch
---

The Sidecar Describe lens quotes each vague done-when check and gives the tightened wording in its reply, for the operator to apply with `rex update` or the item editor. It no longer sends tightened checks through `propose_prd_change`, which only adds items and left a duplicate.
