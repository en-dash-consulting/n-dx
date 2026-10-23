---
id: "5a73fbb1-98d0-4b12-baa8-93069c1ce239"
type: "task"
title: "Merge driver core: rex merge-driver command with three-way frontmatter-aware merge"
slug: "merge-driver-core-rex-merge-driver"
description: "PR 1: the rex merge-driver <ancestor> <ours> <theirs> command and its pure core. Union (three-way set) merge for tags/blockedBy, latest-lastModified wins for status/priority, textual three-way for description and body, standard conflict markers plus nonzero exit only for genuinely conflicting fields; result written to the ours path per git merge-driver protocol. Unit tests per field class and a repo-level integration test merging two divergent PRD branches cleanly."
---
