---
id: "6518b3be-eda4-4f06-9d78-1b592049ce4a"
type: "capability"
title: "Reshape Same-Parent Duplicate Merge with Backup Audit Trail"
slug: "reshape-same-parent-duplicate-merge"
statement: "When ndx reshape merges duplicate items under the same parent, it records an audit trail of each merge, including the pre-reshape git commit, in .rex/archive.json and in its CLI output."
criteria: [{"id":"c1","text":"Before reshape changes the folder tree, the reshape command shall capture the current git HEAD commit hash as a restore point, once per invocation."},{"id":"c2","text":"When reshape performs a same-parent merge, the reshape command shall append one entry to .rex/archive.json containing survivorId, mergedFromIds, a reasoning string, preReshapeCommit and a timestamp."},{"id":"c3","text":"The reshape command shall record the same preReshapeCommit value in every archive entry produced by one reshape invocation."},{"id":"c4","text":"The reshape merge reasoning string shall state which fields were taken from the older item and which from the newer item, and summarize how child items were re-parented."},{"id":"c5","text":"When reshape performs a same-parent merge, the reshape CLI shall print 'Merged <oldId> → <survivorId> — <reasoning>' for that merge."},{"id":"c6","text":"When reshape has performed merges, the reshape CLI shall print a single closing line showing the pre-reshape commit hash for rollback."},{"id":"c7","text":"If the working directory is not a git repository or HEAD cannot be resolved, the reshape command shall record preReshapeCommit as 'no-git' and complete the reshape."}]
source: "smart-add"
---

Extend ndx reshape so that within a single parent it merges duplicate epics/features/tasks (sibling-only — never across different parents), preferring the newer item's fields while preserving any non-empty fields the older item has that the newer one lacks. Every merge must record an audit trail capturing the merge reasoning, the discarded old item IDs, and the pre-reshape git commit hash so the operation is reversible.
