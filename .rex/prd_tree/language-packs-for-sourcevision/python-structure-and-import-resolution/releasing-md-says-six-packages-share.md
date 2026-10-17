---
id: "f75edb08-84e1-4f55-95cb-5834f9c3c54d"
level: "task"
title: "RELEASING.md says six packages share the fixed-group version; the group has fifteen"
status: "in_progress"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
startedAt: "2026-10-17T01:56:12.330Z"
acceptanceCriteria:
  - "RELEASING.md's fixed-group statement names every package in .changeset/config.json's fixed group, or defers to that file"
description: "Verdict: out-of-scope, pre-existing. RELEASING.md:3 says \"All packages (core, rex, hench, sourcevision, llm-client, web) are published to npm. They share a single version number via a Changesets fixed group.\" But .changeset/config.json's fixed group also holds lang-kit, lang-runtime, lang-java, lang-go, lang-sql, lang-terraform, lang-python, graview and graview-face. A releaser who trusts line 3 would not expect the packs to move with the group, which is the mismatch the task above tracks. Fix: list every fixed-group member, or point at .changeset/config.json instead of listing them. This is a one-line doc edit with no risk."
lastModified: "2026-10-17T01:56:12.939Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
