---
"@n-dx/lang-kit": patch
"@n-dx/sourcevision": patch
---

Define the facts-out pack contract in `@n-dx/lang-kit`: per-file `FileFacts` with imports, symbols and calls produced today and routes, components, outbound calls and resources declared for later packs. sourcevision's Java, Go and SQL packs fill it through a new adapter, and the Java and Go import graph is built from the imports facts. Analysis output is unchanged.
