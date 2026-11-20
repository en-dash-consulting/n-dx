---
"@n-dx/llm-client": patch
"@n-dx/lang-kit": patch
"@n-dx/lang-runtime": patch
"@n-dx/lang-go": patch
"@n-dx/lang-java": patch
"@n-dx/lang-python": patch
"@n-dx/lang-terraform": patch
---

Internal: refactor llm-client and the language packs without changing behaviour: shared HTTP retry and child-process settling, one merged project-config loader, vendor failover as a table, and shared span helpers in the packs.
