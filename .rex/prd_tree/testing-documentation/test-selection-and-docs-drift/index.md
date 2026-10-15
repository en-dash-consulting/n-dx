---
id: "2f3726fb-a014-453c-8b34-0006dfa08d8a"
level: "feature"
title: "Test selection and docs drift"
status: "pending"
priority: "medium"
tags:
  - "cleanup"
source: "overnight-cleanup"
acceptanceCriteria: []
description: "The hench gate's suite selection misses docs pages that root tests validate, and the MCP Integration guide still describes HTTP MCP as single-project. Overnight cleanup stack layer 3 (fix/cleanup-3-test-selection-docs)."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-15T06:31:00.861Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [a docs-only change to a page a full-root test validates (README.md, docs/guide/*.md, docs/cli-ui-gap.md) selects no suite](./a-docs-only-change-to-a-page-a-full.md) | completed |
| [MCP Integration guide still says HTTP MCP is single-project until a 0.7.0 hub](./mcp-integration-guide-still-says-http.md) | pending |
| [VALIDATED_DOC_PAGES is hand-maintained: a root test that starts reading a new docs page selects nothing until someone adds a group](./validated-doc-pages-is-hand-maintained.md) | pending |
