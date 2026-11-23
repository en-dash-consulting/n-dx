---
"@n-dx/lang-kit": patch
"@n-dx/lang-runtime": patch
---

Internal: the language pack contract gains `trait`, `namespace` and `constant` symbol kinds, a `conditional` import guard (`IMPORT_GUARDS`) and optional `WrittenImport.candidates` for dynamic includes, which never become import edges. No pack produces them yet, so analyze output is unchanged.
