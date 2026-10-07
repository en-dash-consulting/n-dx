---
"@n-dx/rex": patch
---

PRD folder tree: a backslash in a quoted string field (e.g. a title `C:\new dir`) no longer reads back as a newline, and `\r` and `\uXXXX` escapes now decode. The frontmatter parser decodes double-quoted values with `JSON.parse`, matching how both tree writers quote them.
