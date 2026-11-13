---
"@n-dx/web": patch
---

Settings › Project now offers every project language n-dx supports: Swift, Python, C# and Java join Auto-detect, TypeScript, JavaScript and Go.

The dashboard used to offer four languages and refuse the rest with a 400, though `ndx config language` and the analysis already accepted all seven. A project already set to Python showed a language list with no matching entry. The dashboard's list is now held to `@n-dx/lang-kit`'s by a test.
