---
"@n-dx/sourcevision": patch
---

Add an internal tree-sitter runner that parses a file with a language pack's grammar, runs its query files, and returns captures with positions plus whether the tree has ERROR or MISSING nodes. Grammars load once per process, trees and queries are freed, and oversized files are skipped and counted.
