---
id: "f1ea87fd-90d2-459a-ad44-0bf015166728"
type: "change"
title: "Detect database engines from dependencies, images and config"
slug: "detect-database-engines-from"
intent: "Build in-memory database candidates from: dependency coordinates (Java JDBC drivers and Spring Data starters; Go modules such as jackc/pgx, lib/pq, go-sql-driver/mysql, gorm.io/driver/*, mongo-driver, go-redis; Node pg, mysql2, mongoose, prisma), container images in compose and Kubernetes manifests (postgres:15 gives engine and version), config keys and URL schemes (jdbc:postgresql://, mongodb+srv://, DATABASE_URL, spring.datasource.*), and the Terraform model (engine and engine_version). Each candidate lists its evidence and grade. The driver table is a detection table with provenance. Only the scheme and engine are kept from a URL: never the host, user or password.\n\nScope (2026-10-08): the Terraform model (c87df119) is held for the Sterling H conversation, so this task covers dependencies, images and config only; the Terraform source is a separate task blocked by c87df119. Read dependency coordinates from the existing in-memory build models (readMavenBuildModels, readGradleBuildModels, readGoBuildModels) rather than re-parsing build files. Sterling H gate (LS12, LS13, C1, C2): results stay in memory. Write nothing new to analysis artifacts (no infrastructure.json, no outbound.json), and do not edit analyzers/infrastructure.ts or IAC_KINDS."
acceptanceCriteria:
  - "Candidates are found on ThingsBoard, PetClinic, gitea and microservices-demo with evidence per signal"
  - "Image tags give engine versions where present"
  - "A test proves hosts, users and passwords from connection strings are never kept"
  - "The driver table records provenance per entry"
  - "The six static root policy tests pass"
touches:
  - "d8fccdeb-f9b5-4da2-be41-c5594fa0451f"
priority: "medium"
tags:
  - "language-packs"
  - "database"
  - "sourcevision"
  - "pr-9"
source: "roadmap"
blockedBy:
  - "8d693fcd-f39f-4008-8149-24596e014479"
---
