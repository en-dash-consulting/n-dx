---
id: "aac0a41c-0157-4cca-a75d-efd7655ba909"
level: "feature"
title: "Import Analyzer Language Dispatch"
status: "completed"
source: "smart-add"
startedAt: "2026-03-26T05:34:37.680Z"
completedAt: "2026-03-26T05:34:37.680Z"
acceptanceCriteria: []
description: "Modify the SourceVision import analyzer (imports.ts) to dispatch to the Go import parser when processing .go files, reading go.mod once per invocation and producing file-to-package edges for internal imports. Integration tests validate the full import graph against the Go fixture."
---

## Children

| Title | Status |
|-------|--------|
| [Modify imports.ts to route .go files to the Go import parser](./modify-imports-ts-to-route-go-195091.md) | completed |
| [Write integration tests validating the Go import graph against the fixture project](./write-integration-tests-c42858.md) | completed |
