---
"@n-dx/rex": patch
---

Stop the `rex import-bundle --replace` prompt understating what it will destroy.

The confirmation quoted `existing.items.length` — the number of *top-level*
items. A PRD of 3 epics holding 240 features, tasks and subtasks asked

    Replace the existing PRD (3 items) with the bundle? [y/N]

and then reported `Replaced 240 items`. The one message whose only job is to
convey the scale of an irreversible wipe understated it by roughly eightyfold.

The prompt now quotes `countItems`, which is what `mergeBundle` already uses for
the `replaced` count it reports afterwards, so the number the operator agrees to
and the number they are charged cannot disagree.
