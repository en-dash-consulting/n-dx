---
id: "e578fe1e-d9b5-4539-a5c5-e43d5b376abb"
type: "change"
title: "Correct the Java resolver changeset that says analysis output is unchanged"
slug: "correct-the-java-resolver-changeset"
intent: "Stack review (#763): .changeset/sv-java-resolver.md says Nothing consumes the resolver yet, so analysis output is unchanged, but sv-java-analyze-edges.md in the same PR says sv analyze now builds Java edges; both land in one CHANGELOG entry. Drop that sentence (or merge the two changesets into one accurate note). Changeset files only."
acceptanceCriteria:
  - "No changeset in this PR says analysis output is unchanged while another says Java edges are added"
touches:
  - "f522e7ae-44aa-458b-80ef-7a1132416c0c"
priority: "high"
source: "review"
---
