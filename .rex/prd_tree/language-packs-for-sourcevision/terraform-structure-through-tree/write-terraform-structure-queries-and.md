---
id: "c87df119-1d65-4f73-9675-a6f0b3b21858"
level: "task"
title: "Write Terraform structure queries and build the in-memory model"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "terraform"
  - "sourcevision"
  - "pr-8"
blockedBy:
  - "442fc751-4ea4-4a7f-855f-77a9e31f9a4a"
source: "roadmap"
acceptanceCriteria:
  - "Goldens cover resources, data sources, modules (local and registry), providers with versions, backend, variables, outputs, locals and references"
  - "Audit attributes are extracted for RDS, Cloud SQL, Lambda or Cloud Functions, and EKS or GKE fixtures"
  - "Local modules are followed and registry module sources are parsed"
  - "On the corpus the model is a superset of infrastructure.ts's resources, with any difference listed"
  - "The six static root policy tests pass"
description: "Queries for resource and data blocks (type, name, span), module blocks (source, version), provider blocks, the terraform block (required_providers with versions, backend), variable, output and locals, plus reference expressions (type.name.attribute, module.x.y, var.x, local.x). Build an in-memory model: resources with the attributes an audit needs (engine, engine_version, database_version, runtime, image, kubernetes/cluster version), module calls (local sources followed; registry sources parsed into namespace/name/provider with version), provider versions and a reference graph. Detection-table entries (for example registry module to resource kind) carry provenance. Compare with infrastructure.ts: the model must find every resource the regex finds."
lastModified: "2026-10-08T03:09:11.813Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
