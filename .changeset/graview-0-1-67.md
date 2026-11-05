---
"@n-dx/graview": patch
"@n-dx/graview-face": patch
---

Graview 0.1.67. The adapter's pinned `graview` release and the face's Graview packages move from 0.1.26 to 0.1.67. The face imports `placesOf` from `@graview/core/seat` and `readableFields` from `@graview/core/words`, where Graview moved them out of the root barrel. The "Runs, by outcome" timeline never drew (a timeline lays spans out in numbers, and runs span dates), and Graview 0.1.63 reports it as `lens-cannot-draw`; runs are now a calendar, "When runs ran". Changes and tasks declare `archives: false` and `tidying: "never"`, so the face no longer offers Graview's new archive, merge and tidying acts on the two kinds that sync with rex, which rex could not take; and while sync runs, the face refuses (and does not offer) the `connect-` and `disconnect-` relation acts Graview now derives on them, naming the rex command that changes the link instead. `ndx graview` passes `--allow-origin`, `--remote-url`, `--views`, `--face`, `--previous`, `--width`, `--id` and `--seed` on with their values instead of reading the value as the project directory, and resolves the path-valued ones against the project.
