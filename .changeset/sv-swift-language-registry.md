---
"@n-dx/sourcevision": patch
---

Register Swift as a first-class language in the language registry so `.swift`
files are actually discovered and reach the Swift import resolver. Without
this, `Package.swift` / `.xcodeproj` projects were being treated as TypeScript
fallback — `.swift` was filtered out of `parseableExtensions` before phase 2
ran, leaving the import graph empty even though the Swift resolver was wired
in. Adds the `swiftConfig` (extensions, test/generated patterns, build/skip
directories, `Package.swift` as module file), wires it through
`detectLanguage` / `detectLanguages`, and adds Swift to `VALID_LANGUAGE_IDS`.
Tiebreak preference on tied counts: TypeScript > Swift > Go (preserves the
legacy "TS wins go.mod+package.json tie" behavior).
