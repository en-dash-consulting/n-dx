---
"@n-dx/rex": patch
"@n-dx/hench": patch
---

A branch cut again under a merged branch's name no longer inherits that branch's finished work set. Assignments whose `delivery` already named the branch where it left the default branch belong to the earlier branch and are not in the set; `rex branch show`, `rex next`, `get_next_task` and `ndx work --resolve` agree, and name those tasks (`earlierUse` in JSON). A set whose tasks are all done on this branch still narrows selection and now says it is finished instead of "Nothing left". Without a default branch to compare against (or in a shallow clone), every assignment counts, as before.
