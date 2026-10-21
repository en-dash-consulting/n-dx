---
"@n-dx/rex": patch
"@n-dx/web": patch
---

Code-coverage path matching honours a path separator: `lib/util.ts` in a task's description no longer matches a changed `mylib/util.ts`, while `src/lib/util.ts` still matches `lib/util.ts` in both directions. The index.md Commits table escapes `|` and `\` in the author cell as it already did in the message cell, and the dashboard's parser splits rows on unescaped pipes only and undoes both escapes, so a message or author holding either round-trips losslessly. The frontmatter fallback decoder (a double-quoted scalar that is not valid JSON) now also decodes `\b`, `\f`, `\/` and a four-hex-digit `\uXXXX` like JSON, keeping a shorter `\u` literal.
