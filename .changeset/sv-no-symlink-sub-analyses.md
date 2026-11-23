---
"@n-dx/sourcevision": patch
"@n-dx/lang-kit": patch
---

`sv analyze` no longer follows a symlinked directory when it looks for sub-analyses, so `--deep` never analyzes or writes outside the project.

Action needed: a symlinked directory is no longer promoted as a sub-analysis. Analyze its target on its own with `sv analyze <target>`.

Before, a link such as `vendor-link -> ../other-project` pulled that project's zones and file paths into this project's `zones.json` and `CONTEXT.md`, and `--deep` ran analyze inside it. Two links back to their own directory made the search branch without end, and analyze hung in the zones phase. A sub-analysis whose `.sourcevision/` resolves outside the project is now also refused.

The IaC, API-contract, `go.mod` and Java package-root scans now read regular files only, as the inventory does, so a symlinked file is never read.
