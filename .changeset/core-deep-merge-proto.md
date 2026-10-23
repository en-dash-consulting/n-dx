---
"@n-dx/core": patch
---

`ndx config` skips `__proto__`, `constructor` and `prototype` keys while merging `.n-dx.json` and `.n-dx.local.json`. A literal `"__proto__"` key in either file used to set the merged object's prototype, so every reader of the project config saw fields the file never wrote as settings.
