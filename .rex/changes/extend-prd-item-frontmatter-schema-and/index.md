---
id: "55f50853-4273-46d0-ab1b-e809505ea707"
type: "change"
title: "Extend PRD item frontmatter schema and parser/serializer for commit attribution"
slug: "extend-prd-item-frontmatter-schema-and"
intent: "Add `commits` (array of objects with `hash` (full SHA), `author`, `authorEmail`, `timestamp`, optional `message`) to the PRD item frontmatter. Update the markdown parser/serializer to round-trip these fields with full fidelity. Update PRDItem TypeScript types and the JSON Schema used by validation. Ensure absent/empty fields parse cleanly for legacy items."
acceptanceCriteria:
  - "PRDItem type includes `commits: CommitAttribution[]` with documented field semantics"
  - "Markdown serializer emits commit attribution under a stable frontmatter key with array-of-objects layout"
  - "Parser accepts both absent and empty-array states for legacy items without warnings"
  - "Round-trip fidelity test: serialize → parse → serialize produces byte-identical output for items with 0, 1, and N commits"
  - "JSON schema in rex package updated and referenced by validate command"
amends: [{"target":"78798ece-882f-44c9-9996-6eec6e909989","delta":"modified","summary":"Extend PRD item frontmatter schema and parser/serializer for commit attribution","base":"71cac2ea9e4f6606c464be8699c643488f41e00a11ef284a1cd80c1cffd240d4"}]
priority: "high"
tags:
  - "rex"
  - "prd"
  - "schema"
source: "smart-add"
---
