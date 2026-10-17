---
id: "71c1e226-2c18-42e0-a895-d8eecd4a4638"
level: "task"
title: "Read sqlc JSON configs with arrays and multi-line lists"
status: "pending"
priority: "medium"
tags:
  - "review-fixes"
  - "lang-sql"
  - "pr-18"
source: "review"
acceptanceCriteria:
  - "sqlc .json configs are parsed as JSON; schema/queries arrays (flow and multi-line) yield every path"
  - "YAML flow lists with a trailing comma and multi-line lists are read; fixtures cover each form"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"The hench sandbox may block ~/.cache corpora; leave corpus checks to the session and do not capture follow-ups for them."}
description: "Stack review (#768, sql-migrations.ts around line 105; find its home at the stack top, sourcevision or lang-sql). It is latent, since nothing calls it from analyze yet, but it is still wrong. sqlc accepts arrays for schema and queries:\n- In pretty-printed JSON, `\"schema\": [\"db/schema.sql\", \"db/more.sql\"],` has a trailing comma, so `/^\\[(.*)\\]$/` fails. The whole bracket text becomes one bogus path, giving sqlFiles: [].\n- A multi-line JSON array yields the path `\"[\"` for both keys, and detectMigrationTools returns [].\n\nThe docstring claims scalar, flow-list and block-list support. Fix: JSON.parse `.json` configs and walk sql[]/packages[]. For YAML, strip a trailing `,` before the flow-list match and handle a `[` that opens a multi-line list. Add fixtures for sqlc JSON with scalar, flow array, multi-line array, and the YAML forms."
lastModified: "2026-10-17T06:55:47.718Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
