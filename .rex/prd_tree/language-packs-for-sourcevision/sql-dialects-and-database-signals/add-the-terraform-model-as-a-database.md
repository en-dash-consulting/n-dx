---
id: "4cfaf841-f676-4af1-98fa-61c2b6cb530b"
level: "task"
title: "Add the Terraform model as a database-engine source"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "sql"
  - "terraform"
  - "sourcevision"
  - "pr-9"
blockedBy:
  - "f1ea87fd-90d2-459a-ad44-0bf015166728"
  - "c87df119-1d65-4f73-9675-a6f0b3b21858"
source: "operator"
acceptanceCriteria:
  - "Terraform database resources yield database-engine candidates with engine, version, evidence and grade"
  - "Candidates are found on terraform-aws-rds and cloud-foundation-fabric"
  - "Results stay in memory; nothing new is written to analysis artifacts"
  - "The six static root policy tests pass"
description: "Split from f1ea87fd-90d2-459a-ad44-0bf015166728 (2026-10-08) because the Terraform in-memory model, c87df119, is held for the Sterling H conversation. Once c87df119 lands, add its database resources (aws_db_instance, aws_rds_cluster, google_sql_database_instance and similar, with engine, engine_version and database_version) as a candidate source in the database-engine detector, with evidence and grade like the other sources. Check the corpus candidates on terraform-aws-rds, cloud-foundation-fabric and microservices-demo. Sterling H gate (LS12, LS13, C1, C2): results stay in memory. Write nothing new to analysis artifacts (no infrastructure.json, no outbound.json), and do not edit analyzers/infrastructure.ts or IAC_KINDS."
lastModified: "2026-10-08T08:06:01.904Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
