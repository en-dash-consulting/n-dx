---
id: "41a438d4-def7-4e85-ac41-e7b023184764"
type: "capability"
title: "Go Fixture Enhancement"
slug: "go-fixture-enhancement"
statement: "The sourcevision Go fixture project covers aliased, blank and test-file imports, lists its third-party dependencies in go.mod, and includes a coverage map naming the fixture file that exercises each import syntax variant."
criteria: [{"id":"c1","text":"The Go fixture shall include a Go source file with at least one aliased import."},{"id":"c2","text":"The Go fixture shall include a Go source file with at least one blank (side-effect) import of the form _ \"pkg\"."},{"id":"c3","text":"The Go fixture shall include at least one _test.go file that imports testing or testing/assert."},{"id":"c4","text":"The Go fixture's go.mod require block shall list every third-party package that the fixture's source files import."},{"id":"c5","text":"The Go fixture's files shall follow the fixture's existing package and directory naming conventions."},{"id":"c6","text":"When the Go import parser reads the fixture's files, the parser shall complete without error."},{"id":"c7","text":"The Go fixture's coverage map shall map each of the single, grouped, aliased, blank and dot import variants to at least one fixture file."},{"id":"c8","text":"The coverage map shall list each fixture file with the import variants it exercises, either in go-imports.test.ts or in a FIXTURE.md file in the fixture directory."},{"id":"c9","text":"If an import variant is intentionally absent from the fixture, the coverage map shall name that variant and give the reason it is absent."},{"id":"c10","text":"The coverage map shall match the files that are currently in the Go fixture."}]
source: "smart-add"
---

Extend the Go fixture project to cover import syntax edge cases required by the parser (aliased, blank, dot imports, test files), update go.mod to match new dependencies, and produce a coverage map documenting which fixture file exercises which syntax variant.
