---
"@n-dx/sourcevision": patch
---

`sv analyze` now builds Go import edges with the Go language pack (tree-sitter queries plus a resolver that reads `go.mod`, `go.work` and `vendor/modules.txt`) instead of the regex parser. Projects with nested modules and no root `go.mod` gain internal edges between packages that were previously reported as external imports. Imports of a required module nested under the project's own module path are now external imports, where the regex parser drew edges to project directories that do not exist. If the Go grammar is not built or cannot run, a single notice says so and Go edges come from the regex parser as before, so no Go repository loses its import graph.
