---
id: "82262cbb-0025-4880-8c12-cea479859f7b"
type: "change"
title: "Detect Go generated files from the Code generated header"
slug: "detect-go-generated-files-from-the"
intent: "Go marks generated files with a line matching ^// Code generated .* DO NOT EDIT\\.$ before the package clause (https://go.dev/s/generatedcode). This covers *.pb.go, sqlc, ent, stringer and mockgen output, which path patterns miss. LanguageConfig.generatedFilePatterns are path-only, so add an optional content check (for example a generatedHeaderPattern read from the first lines of the file during inventory) and set it for Go. This intentionally changes the role of Go files that carry the header, and only those; every other file keeps its role."
acceptanceCriteria:
  - "A .go file whose header matches the generated-code rule gets the generated role"
  - "A file with the phrase after the package clause, or in a non-Go file, does not"
  - "Only files carrying the header change role; other inventory output is unchanged"
  - "The rule records its provenance (the Go spec URL and the date verified)"
  - "The six static root policy tests pass"
touches:
  - "2fc859c0-090f-43bb-b1b4-36415478bae8"
priority: "medium"
tags:
  - "language-packs"
  - "go"
  - "sourcevision"
  - "pr-6"
source: "roadmap"
---
