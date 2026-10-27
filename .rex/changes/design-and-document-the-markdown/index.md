---
id: "52811e0d-fa0f-4cf8-9879-020d35f90473"
type: "change"
title: "Design and document the markdown schema for full-fidelity PRD tree representation"
slug: "design-and-document-the-markdown"
intent: "Define a markdown structure that captures every PRD field (id, status, priority, tags, description, acceptanceCriteria, loe, loeRationale, loeConfidence, startedAt, completedAt, tokenUsage, duration) without loss. The schema must be both human-readable and machine-parseable. Hierarchy (epic → feature → task → subtask) is encoded via heading levels; metadata fields use a consistent encoding such as YAML front-matter blocks or structured HTML comment annotations. Produce a spec document under the rex package to serve as the authoritative reference for parser and serializer implementations."
acceptanceCriteria:
  - "Schema spec document exists at packages/rex/docs/prd-markdown-schema.md"
  - "All current PRD field types are covered: strings, arrays (tags, acceptanceCriteria), numbers (loe), enums (status, priority, loeConfidence), ISO timestamps (startedAt, completedAt), and nested token/duration objects"
  - "Hierarchy levels epic/feature/task/subtask are distinguishable from markdown heading level alone"
  - "Metadata encoding is consistent and unambiguous — a field present in JSON must have exactly one encoding in markdown with no information collision"
  - "Edge cases documented: null/undefined fields, empty arrays, special characters in titles, multi-line descriptions"
touches:
  - "6687abd2-80f8-43e0-973e-f5242b635378"
priority: "critical"
tags:
  - "rex"
  - "storage"
  - "markdown"
source: "smart-add"
---
