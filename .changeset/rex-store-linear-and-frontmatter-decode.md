---
"@n-dx/rex": patch
"@n-dx/web": patch
---

A hand- or agent-written `index.md` whose double-quoted frontmatter value holds an escape JSON lacks (such as `\x`) is now decoded in one pass. The fallback decoder read its own output: `C:\\new` became `C:\new` and then `C:` followed by a line feed, and every save after that compounded the change. The escapes JSON shares (`\n`, `\t`, `\r`, `\"`, `\\`) are decoded; any other `\c` is kept as written, as before.

Four scans of repository content no longer take quadratic time: the block-scalar chomping in both the folder-tree parser and the legacy `prd.md` parser (a run of thousands of blank lines inside a description), the trailing-punctuation trim on a requirement sentence extracted from an analysed README, and the number check the legacy serializer runs on every string scalar. Results are unchanged. A commit message in a generated `index.md` commits table now escapes `\` as well as `|` and folds line breaks, so a message cannot break out of its cell. The web package drops an unused import.
