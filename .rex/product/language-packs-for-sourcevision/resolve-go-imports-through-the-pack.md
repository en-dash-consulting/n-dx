---
id: "72b0abf4-b4be-4c2a-8336-dd84824ed71b"
type: "capability"
title: "Resolve Go imports through the pack"
slug: "resolve-go-imports-through-the-pack"
statement: "Sourcevision builds Go import edges through the Go language pack: it reads go.mod and go.work, resolves import paths to package files, and falls back to the regex parser whenever the pack cannot run."
criteria: [{"id":"c1","text":"When reading a go.mod file, sourcevision shall record the module path, the go and toolchain directives, require entries with their versions and the // indirect marker, replace directives in both local-path and version forms, and exclude directives."},{"id":"c2","text":"When reading a go.work file, sourcevision shall record its use and replace directives."},{"id":"c3","text":"Sourcevision shall keep the Go build model in memory and shall write nothing from it to analysis artifacts."},{"id":"c4","text":"If a go.mod or go.work file is unreadable or malformed, the Go build reader shall report it as a notice instead of throwing."},{"id":"c5","text":"If a project subdirectory cannot be listed, the Go build reader shall still resolve and shall report the skipped directory as a notice."},{"id":"c6","text":"The Go resolver shall resolve import paths through the go.mod module path, each go.work module, replace directives that point at local directories, and vendor/."},{"id":"c7","text":"The Go resolver shall classify standard-library and external module imports the same way the regex parser does."},{"id":"c8","text":"When an imported Go package's only files exceed the runner's size limit, the Go resolver shall still emit the import edge from the importer to that package."},{"id":"c9","text":"When an import points at a directory that has no .go files in the inventory, the Go resolver shall drop the edge."},{"id":"c10","text":"When the runner does not parse a pack file because it is unreadable or oversized, buildPackImportGraph shall pass that file's path to the resolver's prepare step as an unparsed path."},{"id":"c11","text":"When the Go grammar is built, the imports phase shall take Go import edges from the Go pack instead of the regex parser."},{"id":"c12","text":"If the Go grammar is missing, fails to load, or has a query that fails to compile, the imports phase shall take Go import edges from the regex parser rather than leaving Go inventory-only."},{"id":"c13","text":"If the Go resolver's project-level prepare step rejects, the imports phase shall take Go import edges from the regex parser instead of failing."},{"id":"c14","text":"When a Go repository is analysed incrementally, the imports phase shall keep no stale Go import edges."},{"id":"c15","text":"Sourcevision shall produce Go import edges from the pack that match or improve on the regex parser's edges across the corpus."},{"id":"c16","text":"Sourcevision shall leave analysis output for non-Go repositories unchanged."}]
tags:
  - "language-packs"
  - "go"
  - "sourcevision"
  - "side-stack"
  - "pr-7"
source: "roadmap"
priority: "medium"
---

Move Go import edges from the regex parser to the Go pack once the pack matches or beats it. Read go.mod and go.work (with versions, held in memory), resolve import paths to package files, and switch the imports phase over. Without a built grammar, Go falls back to the regex parser rather than to inventory-only, so no Go repository loses edges.

Side stack, PR 7. Merge the final Java PR 4 into this stack before starting, because this feature edits the same imports wiring.
