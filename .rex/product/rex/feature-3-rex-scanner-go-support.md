---
id: "e117f1d3-5b28-4fe0-ad8b-8acc7c030963"
type: "capability"
title: "Feature 3: Rex Scanner Go Support"
slug: "feature-3-rex-scanner-go-support"
statement: "Rex's analyze scanners understand Go project structure: they read module, Go version and dependency information from go.mod, recognize Go test files, and skip Go-specific directories and files."
criteria: [{"id":"c1","text":"When Rex runs an analysis scan, the scanner shall skip the vendor/ directory."},{"id":"c2","text":"When Rex runs an analysis scan, the scanner shall not scan go.mod or go.sum as documentation files."},{"id":"c3","text":"The test detection logic shall recognize files ending in _test.go as test files."},{"id":"c4","text":"The scanGoMod scanner shall read the module name, the Go version and the require dependencies from go.mod."},{"id":"c5","text":"The scanGoMod scanner shall return its dependency list and version information in the same structure scanPackageJson uses, where the two apply."},{"id":"c6","text":"If go.mod is missing, the scanGoMod scanner shall return an empty or null result without failing."},{"id":"c7","text":"When Rex analyzes a Go project directory, Rex shall produce meaningful analysis proposals."},{"id":"c8","text":"Rex shall scan JavaScript and TypeScript projects exactly as it did before Go support was added."}]
source: "smart-add"
---

Update Rex's analyze scanners to understand Go project structure: parse `go.mod` for dependency information, detect Go test files, and skip Go-specific directories.
