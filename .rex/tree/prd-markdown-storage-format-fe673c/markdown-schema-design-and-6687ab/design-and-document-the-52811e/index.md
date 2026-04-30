---
id: "52811e0d-fa0f-4cf8-9879-020d35f90473"
level: "task"
title: "Design and document the markdown schema for full-fidelity PRD tree representation"
status: "completed"
priority: "critical"
tags:
  - "rex"
  - "storage"
  - "markdown"
source: "smart-add"
startedAt: "2026-04-23T19:26:31.234Z"
completedAt: "2026-04-23T19:46:56.962Z"
resolutionType: "code-change"
resolutionDetail: "Created packages/rex/docs/prd-markdown-schema.md — authoritative spec for the PRD markdown format covering all fields, hierarchy encoding, edge cases, and parser/serializer contracts."
acceptanceCriteria:
  - "Schema spec document exists at packages/rex/docs/prd-markdown-schema.md"
  - "All current PRD field types are covered: strings, arrays (tags, acceptanceCriteria), numbers (loe), enums (status, priority, loeConfidence), ISO timestamps (startedAt, completedAt), and nested token/duration objects"
  - "Hierarchy levels epic/feature/task/subtask are distinguishable from markdown heading level alone"
  - "Metadata encoding is consistent and unambiguous — a field present in JSON must have exactly one encoding in markdown with no information collision"
  - "Edge cases documented: null/undefined fields, empty arrays, special characters in titles, multi-line descriptions"
description: "Define a markdown structure that captures every PRD field (id, status, priority, tags, description, acceptanceCriteria, loe, loeRationale, loeConfidence, startedAt, completedAt, tokenUsage, duration) without loss. The schema must be both human-readable and machine-parseable. Hierarchy (epic → feature → task → subtask) is encoded via heading levels; metadata fields use a consistent encoding such as YAML front-matter blocks or structured HTML comment annotations. Produce a spec document under the rex package to serve as the authoritative reference for parser and serializer implementations."
---

# Design and document the markdown schema for full-fidelity PRD tree representation

🔴 [completed]

## Summary

Define a markdown structure that captures every PRD field (id, status, priority, tags, description, acceptanceCriteria, loe, loeRationale, loeConfidence, startedAt, completedAt, tokenUsage, duration) without loss. The schema must be both human-readable and machine-parseable. Hierarchy (epic → feature → task → subtask) is encoded via heading levels; metadata fields use a consistent encoding such as YAML front-matter blocks or structured HTML comment annotations. Produce a spec document under the rex package to serve as the authoritative reference for parser and serializer implementations.

## Info

- **Status:** completed
- **Priority:** critical
- **Tags:** rex, storage, markdown
- **Level:** task
- **Started:** 2026-04-23T19:26:31.234Z
- **Completed:** 2026-04-23T19:46:56.962Z
- **Duration:** 20m
