---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
"@n-dx/rex": patch
"@n-dx/core": patch
"@n-dx/web": patch
---

Auth and key messages put the vendor CLI login first, point at `ndx config credentials.<vendor>` for a key, never suggest a key as a command-line value, and say that storing a key does not switch modes. A refused interpreter `--helper` prints one line.
