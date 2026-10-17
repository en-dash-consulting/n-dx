---
"@n-dx/sourcevision": patch
---

Classify Go files that declare themselves generated as `generated`.

A `.go` file with a `// Code generated ... DO NOT EDIT.` line before its
`package` clause (the convention protoc, sqlc, ent, mockgen and stringer
follow) now has role `generated` instead of `source`, even when its path
matches no generated-file pattern. The inventory's `summary.byRole`
moves those files from `source` to `generated`, and they
drop out of `classifications.json`, which covers source files only.
