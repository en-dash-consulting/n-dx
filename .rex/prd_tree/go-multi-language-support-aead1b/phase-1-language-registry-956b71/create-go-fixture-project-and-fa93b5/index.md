---
id: "fa93b525-872e-4802-a92b-985a38010776"
level: "task"
title: "Create Go fixture project and language registry test suite"
status: "completed"
priority: "high"
tags:
  - "sourcevision"
  - "go"
  - "testing"
  - "fixtures"
source: "smart-add"
startedAt: "2026-03-26T03:58:52.698Z"
completedAt: "2026-03-26T04:05:45.874Z"
acceptanceCriteria:
  - "tests/fixtures/go-project/ exists with go.mod, go.sum, Makefile, .golangci.yml, cmd/api/main.go, internal/handler/user.go + user_test.go, internal/service/user.go + user_test.go, internal/repository/user.go + user_test.go, internal/middleware/auth.go + logging.go, internal/config/config.go, pkg/response/json.go, testdata/users.json"
  - "language-registry.test.ts asserts Go config includes vendor/ in skipDirectories and _test.go in testFilePatterns"
  - "language-registry.test.ts asserts TypeScript config includes node_modules/ in skipDirectories"
  - "language-detect.test.ts: directory with go.mod only → Go; directory with package.json only → TypeScript; directory with neither → TypeScript (fallback)"
  - "language-detect.test.ts: .n-dx.json with language:'go' overrides marker detection even when no go.mod present"
  - "inventory-go.test.ts: internal/handler/user_test.go classified with role 'test'"
  - "inventory-go.test.ts: cmd/api/main.go classified with role 'source'"
  - "inventory-go.test.ts: vendor/ directory (if present) skipped entirely from inventory"
  - "All existing sourcevision tests continue to pass"
description: "Create tests/fixtures/go-project/ with the standard Go layout specified in the plan (cmd/api/main.go, internal/handler/, internal/service/, internal/repository/, internal/middleware/, internal/config/, pkg/response/, testdata/, go.mod, go.sum, Makefile, .golangci.yml). Write the three test files specified in Phase 1.4: language-registry.test.ts (unit, verifies registry returns correct config per language), language-detect.test.ts (unit, auto-detection from go.mod/package.json/both/neither), and inventory-go.test.ts (integration, runs inventory analyzer against the Go fixture and asserts correct language/role/category classification for each file type)."
---

# Create Go fixture project and language registry test suite

🟠 [completed]

## Summary

Create tests/fixtures/go-project/ with the standard Go layout specified in the plan (cmd/api/main.go, internal/handler/, internal/service/, internal/repository/, internal/middleware/, internal/config/, pkg/response/, testdata/, go.mod, go.sum, Makefile, .golangci.yml). Write the three test files specified in Phase 1.4: language-registry.test.ts (unit, verifies registry returns correct config per language), language-detect.test.ts (unit, auto-detection from go.mod/package.json/both/neither), and inventory-go.test.ts (integration, runs inventory analyzer against the Go fixture and asserts correct language/role/category classification for each file type).

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** sourcevision, go, testing, fixtures
- **Level:** task
- **Started:** 2026-03-26T03:58:52.698Z
- **Completed:** 2026-03-26T04:05:45.874Z
- **Duration:** 6m
