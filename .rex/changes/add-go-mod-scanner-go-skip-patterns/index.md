---
id: "2ba0deed-63c0-4650-bc6d-fb2fafb22687"
type: "change"
title: "Add go.mod scanner, Go skip patterns, and test coverage to Rex"
slug: "add-go-mod-scanner-go-skip-patterns"
intent: "Modify `packages/rex/src/analyze/scanners.ts` to add `\"vendor\"` to `SKIP_DIRS`, add `\"go.mod\"` and `\"go.sum\"` to `SKIP_DOC_FILES`, update test file detection to match `_test.go` files, and create a `scanGoMod()` function that extracts module name, Go version, and dependency list from `go.mod` mirroring the structure of `scanPackageJson()`. Deliver unit tests in the same task — the scanner is simple enough that implementation and verification constitute one focused session. Tests should cover the Go fixture project's `go.mod` and edge cases such as a missing file or empty require block."
acceptanceCriteria:
  - "vendor/ directory is skipped during Rex analysis scans"
  - "go.mod and go.sum are not scanned as documentation files"
  - "_test.go files are recognized as test files by the test detection logic"
  - "scanGoMod reads the module name, Go version, and require dependencies from go.mod"
  - "scanGoMod output structure mirrors scanPackageJson where applicable (dependency list, version info)"
  - "A Go project directory produces meaningful Rex analysis proposals"
  - "Existing JS/TS scanning behavior is completely unchanged"
  - "Tests verify vendor/ is skipped"
  - "Tests verify go.mod/go.sum are treated as config, not scanned as docs"
  - "Tests verify _test.go files are detected as test files"
  - "Tests verify scanGoMod extracts module name, Go version, and dependencies correctly"
  - "Tests verify scanGoMod handles missing go.mod gracefully (returns empty/null)"
  - "All tests pass with zero failures"
amends: [{"target":"e117f1d3-5b28-4fe0-ad8b-8acc7c030963","delta":"modified","summary":"Add go.mod scanner, Go skip patterns, and test coverage to Rex","base":"b267791e80b1850c571ddcec0b4c8e898b5e77affe57ffbec3710e932bb0d669"}]
priority: "medium"
tags:
  - "rex"
  - "go"
  - "scanner"
source: "smart-add"
---
