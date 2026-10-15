---
id: "4cfaf841-f676-4af1-98fa-61c2b6cb530b"
level: "task"
title: "Add the Terraform model as a database-engine source"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "terraform"
  - "sql"
  - "database"
  - "pr-13"
blockedBy:
  - "f8e173a9-c7b8-4a53-83bd-a51d7f54fab8"
source: "operator"
acceptanceCriteria:
  - "Terraform database resources yield database-engine candidates with engine, version, evidence and grade (tests for RDS, Aurora, Cloud SQL, Azure and a resource without an engine attribute)"
  - "database-corpus-report shows Terraform candidates on terraform-aws-rds and cloud-foundation-fabric, and its existing Java and Go lines are unchanged"
  - "database-engines.ts imports no pack; nothing new is written to analysis artifacts"
  - "The root policy suites pass"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
description: "Rewritten 2026-10-15 for the pack architecture. Ryan's PR 13 call: Terraform becomes a database-engine candidate source, in memory; persisting database resources with evidence-tagged links (all five signals) is a later PR.\n\npackages/sourcevision/src/language/database-engines.ts (pure; it stays in sourcevision and must not import the Terraform pack) takes the Terraform pack's resource facts as a candidate source alongside dependencies, container images, config and schema. Database resources (aws_db_instance, aws_rds_cluster, google_sql_database_instance, azurerm_*_server / *_flexible_server and similar) with `attributes.engine`, `attributes.engineVersion` (or database_version) yield candidates with engine, version as written, evidence (the .tf file and line) and a grade like the other sources; a database resource with no engine attribute still yields a low-grade candidate from its type. Map engine strings (mysql, postgres, aurora-postgresql, POSTGRES_15, sqlserver-ex, …) to the engine ids the detector already uses; keep the mapping table in one place with provenance.\n\nThe caller passes the facts in: extend the detector's input (DatabaseEngineInput) with Terraform resource facts, and have packages/sourcevision/scripts/database-corpus-report.mjs load @n-dx/lang-terraform from the workspace and supply them. Nothing is wired into analyze and nothing new is written to analysis artifacts.\n\nVerify (append to this task's log): database-corpus-report on terraform-aws-rds and cloud-foundation-fabric (add them to the report's repositories) and microservices-demo shows the Terraform candidates with their evidence; the existing report lines for the Java and Go corpora are unchanged. Tests cover RDS, Aurora, Cloud SQL and Azure resources and a resource without an engine attribute. No package.json dependency changes. Do not touch rex, hench, core or web source, analyzers/infrastructure.ts or IAC_KINDS."
lastModified: "2026-10-15T05:59:25.998Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
