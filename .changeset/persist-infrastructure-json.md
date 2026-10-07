---
"@n-dx/sourcevision": patch
---

Persist infrastructure discovery as `infrastructure.json`.

Runtime infrastructure and injection seams — the two things the import graph structurally cannot show — were discovered inside the iso export, so what they found existed only in a rendered HTML page and nothing else could read it. Discovery moved to `analyzers/infrastructure.ts`, runs during `sv analyze`, and is written to `infrastructure.json` alongside the other data files.

The logic is the same logic, moved: the same fixture renders to the same sha256 before and after. The export reads the file instead of recomputing and falls back to discovering it when there is none — a repository scanned with no analysis, which is how the standalone iso-map skill runs on an arbitrary repo, and an analysis made before the file existed.

The persisted shape keeps links apart from resources, each carrying whether a person declared the use or source names the resource. Neither array is re-sorted on the way to disk: discovery emits config-declared resources first and a config `usedBy` in written order, so sorting would reorder the map's nodes.
