---
"@n-dx/sourcevision": patch
---

`ndx analyze` with TypeSafe judging now sends ambiguous `code.classify` files to the text model 40 at a time across all batches, not one call per batch, and escalates fewer files.

A Jev answer of "no archetype" at probability 0.45 or above is now taken as the answer (was 0.6). On a large legacy repository the escalation pass was most of a deep run's model time, mostly in calls of one to a few files each. Analyze prints one line with the number of files escalated and the calls they took.
