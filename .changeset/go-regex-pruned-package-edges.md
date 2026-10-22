---
"@n-dx/sourcevision": patch
---

The regex Go import parser, which handles every Go file when the Go pack's grammar is not built, no longer emits an edge to a package directory that holds no inventoried file. Such an import (a directory pruned by `.sourcevisionignore`, or one the inventory never held) is kept as an external package, as the Go pack already does. Previously the edge pointed at a node that did not exist, and the `imports-go-incremental-carryover` test failed on every checkout without the grammar.
