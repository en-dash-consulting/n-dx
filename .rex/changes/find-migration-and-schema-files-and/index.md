---
id: "8d693fcd-f39f-4008-8149-24596e014479"
type: "change"
title: "Find migration and schema files and extract tables with tree-sitter-sql"
slug: "find-migration-and-schema-files-and"
intent: "Pin tree-sitter-sql v0.3.11 (github.com/DerekStride/tree-sitter-sql) additively. Detect migration tools by layout: Flyway (db/migration/V*__*.sql), Liquibase changelogs, golang-migrate (*.up.sql/*.down.sql), goose (-- +goose Up), Atlas, Prisma (schema.prisma), sqlc (sqlc.yaml with queries). Parse .sql files for CREATE/ALTER TABLE names. The grammar is generic, so report the parse rate per dialect rather than assuming every file parses. Corpus: PetClinic's schemas and ThingsBoard's .sql files in ~/.cache/ndx-java-corpus/.\n\nSterling H gate (LS12, LS13, C1, C2): results stay in memory. Write nothing new to analysis artifacts (no infrastructure.json, no outbound.json), and do not edit analyzers/infrastructure.ts or IAC_KINDS."
acceptanceCriteria:
  - "Each migration tool is detected on a fixture"
  - "Table names are extracted from CREATE and ALTER statements"
  - "Parse rate per file on the corpus is recorded in the rex log"
  - "The six static root policy tests pass"
touches:
  - "d8fccdeb-f9b5-4da2-be41-c5594fa0451f"
priority: "medium"
tags:
  - "language-packs"
  - "sql"
  - "sourcevision"
  - "pr-9"
source: "roadmap"
---
