---
id: "a0e35c39-9756-4877-bb92-e38b40d97996"
level: "task"
title: "Classify SQL dialects with evidence"
status: "completed"
priority: "medium"
tags:
  - "language-packs"
  - "sql"
  - "sourcevision"
  - "pr-9"
blockedBy:
  - "8d693fcd-f39f-4008-8149-24596e014479"
source: "roadmap"
startedAt: "2026-10-08T08:18:07.615Z"
completedAt: "2026-10-08T08:26:14.632Z"
endedAt: "2026-10-08T08:26:14.632Z"
resolutionType: "code-change"
resolutionDetail: "Added sql-dialects.ts with provenance-carrying rules and PetClinic goldens"
acceptanceCriteria:
  - "PetClinic's schema files are classified to their dialects in goldens"
  - "Each classification carries confidence and evidence lines"
  - "Every marker rule records provenance"
  - "The six static root policy tests pass"
description: "Classify each SQL file as PostgreSQL, MySQL/MariaDB, SQL Server (T-SQL), Oracle (PL/SQL), SQLite, H2/HSQLDB or unknown, from syntax markers (for example SERIAL, ::casts and RETURNING; AUTO_INCREMENT, backticks and ENGINE=; IDENTITY, NVARCHAR, GO batches and [brackets]; VARCHAR2, NUMBER and PL/SQL blocks; AUTOINCREMENT and PRAGMA), file and folder names, and the migration tool's configuration. Output the dialect, a confidence and the evidence lines. Every marker rule carries provenance (the vendor docs page and date verified). PetClinic ships the same schema in several dialects, which makes a good golden.\n\nSterling H gate (LS12, LS13, C1, C2): results stay in memory. Write nothing new to analysis artifacts (no infrastructure.json, no outbound.json), and do not edit analyzers/infrastructure.ts or IAC_KINDS."
lastModified: "2026-10-08T08:26:14.892Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
