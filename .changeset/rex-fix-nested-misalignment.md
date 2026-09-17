---
"@n-dx/rex": patch
---

`rex fix` now repairs nested parent/child misalignment in one run. On epic(completed) → feature(completed) → task(pending) it judged the epic while the feature still read `completed`, so it reopened only the feature, reported "Fixed 1 issue", and left the epic completed above a pending child — the very inconsistency it exists to find, needing a second run to reach the epic and a third to confirm clean. Misalignment is now decided bottom-up, reading each child's status as the same pass will leave it, so every falsely-completed ancestor is found together and the dry-run plan matches what the run does however deep the nesting goes.
