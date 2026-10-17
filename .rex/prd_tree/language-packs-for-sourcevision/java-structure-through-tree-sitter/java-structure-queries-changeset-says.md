---
id: "f5ac6e67-f34b-45d7-82f3-8cf130aa9ce1"
level: "task"
title: "Java structure-queries changeset says analysis output is unchanged while the stack adds Java edges"
status: "completed"
priority: "high"
source: "review"
startedAt: "2026-10-17T01:47:09.974Z"
completedAt: "2026-10-17T01:48:33.368Z"
endedAt: "2026-10-17T01:48:33.368Z"
resolutionType: "code-change"
resolutionDetail: "Dropped \"Nothing consumes the captures yet, so analysis output is unchanged.\" from .changeset/sv-java-structure-queries.md on the PR 3 branch."
acceptanceCriteria:
  - "sv-java-structure-queries.md no longer says analysis output is unchanged"
description: ".changeset/sv-java-structure-queries.md:5 (added in PR 3, 85ee91d8b) ends \"Nothing consumes the captures yet, so analysis output is unchanged.\" If PR 3 and PR 4 release together, the one @n-dx/sourcevision CHANGELOG entry also carries sv-java-analyze-edges.md (\"sv analyze now builds the import graph for Java\"), so it contradicts itself. This is the same defect e578fe1e fixed for sv-java-resolver.md in PR 4. Found by the adversarial review of e578fe1e; it is out of scope there because the file belongs to PR 3. Verdict: out-of-scope; a cheap one-line fix. Recommended fix: drop the sentence on the PR 3 branch and restack. Alternative: drop it in PR 4, since that is where the claim becomes false."
lastModified: "2026-10-17T01:48:34.144Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
