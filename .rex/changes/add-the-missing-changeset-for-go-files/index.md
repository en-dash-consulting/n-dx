---
id: "dce5c939-6e58-47c2-b102-463a514a06f6"
type: "change"
title: "Add the missing changeset for Go files that declare themselves generated"
slug: "add-the-missing-changeset-for-go-files"
intent: "Stack review (#765): this PR changes user-visible output but has no changeset. Go files with a // Code generated ... DO NOT EDIT. header (sqlc, ent, mockgen, protoc) move from role source to generated, which drops them from classifications.json and changes summary.byRole. Add a @n-dx/sourcevision patch changeset saying so. Changeset file only."
acceptanceCriteria:
  - "A @n-dx/sourcevision patch changeset describes the generated-header role change and its effect on classifications.json and summary.byRole"
amends: [{"target":"2fc859c0-090f-43bb-b1b4-36415478bae8","delta":"modified","summary":"Add the missing changeset for Go files that declare themselves generated","base":"73445d98ba353ec6569dfec06a284a64d2484e52410c9c403e6cb3c04b33ada8"}]
priority: "high"
source: "review"
---
