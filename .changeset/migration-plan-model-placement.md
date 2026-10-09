---
"@n-dx/rex": patch
---

The v2 migration plan can place the changes its rules hold with a model. A text pass (task class `prd.place`, on by default) and a Jev pass (when `rex.placement.models` is `jev` or `both` and a TypeSafe key is present) ask about each held change and decide through `decidePlacement`, so `rex.placement.autoAccept` applies as it does elsewhere. A proposed new capability or constraint is never accepted without a person. The plan file records every raw model answer, so a re-plan with a different accept rule does not ask again. With no model available, or `rulesOnly`, the plan is the rules-only plan. Migration passes now receive the plan context, and `merge` may be async. A placement question carries only the rules shortlist's capabilities, so renaming any other capability keeps the recorded answer, and a replay decides as the recording did. Not wired to a command yet.
