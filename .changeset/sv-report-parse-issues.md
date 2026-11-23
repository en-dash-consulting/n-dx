---
"@n-dx/sourcevision": patch
"@n-dx/lang-kit": patch
"@n-dx/lang-runtime": patch
---

`sv analyze` now reports language-pack files that do not parse cleanly, in one `[<pack>-parse]` line and in `imports.json` `summary.parseIssues`.

The report counts files with syntax errors, files over the parser's 1 MiB limit, unreadable files and files that are not valid UTF-8, with up to 50 sorted example paths for each. It covers every pack the imports phase runs (PHP, Java, Go, Python). Nothing becomes fatal: facts are still read from a file with syntax errors, and a non-UTF-8 file is still parsed. When every file parses cleanly the field is absent and `imports.json` is unchanged. The field names are new and under review.
