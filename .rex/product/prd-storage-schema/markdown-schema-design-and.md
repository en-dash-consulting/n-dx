---
id: "6687abd2-80f8-43e0-973e-f5242b635378"
type: "capability"
title: "Markdown Schema Design and Bidirectional Serialization"
slug: "markdown-schema-design-and"
statement: "Rex converts the in-memory PRD tree to and from a human-readable markdown format that encodes every PRD field without loss."
criteria: [{"id":"c1","text":"The PRD markdown format shall encode every PRD field (id, status, priority, tags, description, acceptanceCriteria, loe, loeRationale, loeConfidence, startedAt, completedAt, tokenUsage, duration), covering string, array, number, enum, ISO timestamp and nested token/duration object types."},{"id":"c2","text":"The PRD markdown format shall make the hierarchy level of each item (epic, feature, task, subtask) distinguishable from its markdown heading level alone."},{"id":"c3","text":"The PRD markdown format shall give each field present in the PRD exactly one markdown encoding, with no collision between fields."},{"id":"c4","text":"The PRD markdown format shall define the encoding of null or undefined fields, empty arrays, special characters in titles and multi-line descriptions."},{"id":"c5","text":"The rex markdown serializer shall convert a complete in-memory PRD tree to a markdown string that conforms to the PRD markdown schema."},{"id":"c6","text":"When given a valid serialized markdown string, the rex markdown parser shall reconstruct the exact PRD tree it was serialized from."},{"id":"c7","text":"The rex markdown serializer and parser shall keep the round-trip invariant that serialize(parse(serialize(tree))) deep-equals serialize(tree) for any valid PRD tree."},{"id":"c8","text":"The rex markdown serializer and parser shall preserve each field's type across a round-trip, keeping numbers as numbers and arrays as arrays."},{"id":"c9","text":"If the markdown input is malformed, the rex markdown parser shall return a typed error rather than throw an uncaught exception."}]
source: "smart-add"
---

Define a human-readable markdown format that encodes all PRD fields with full fidelity, and implement serializers/parsers for converting between the in-memory PRD tree and markdown representations.
