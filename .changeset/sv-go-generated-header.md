---
"@n-dx/sourcevision": patch
---

Classify Go files that declare themselves generated as `generated`.

A `.go` file with a `// Code generated ... DO NOT EDIT.` line before its
`package` clause (the convention protoc, sqlc, ent, mockgen and stringer
follow) now has role `generated` instead of `source`, even when its path
matches no generated-file pattern. This applies when sourcevision treats
the project as Go: a `go.mod` at the analyzed root, or a `go` language
override. The inventory's `summary.byRole`
moves those files from `source` to `generated`, and they
drop out of `classifications.json`, which covers source files only.
