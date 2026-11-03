---
"@n-dx/hench": patch
"@n-dx/llm-client": patch
---

`list_directory` and `search_files` now run every entry they visit through the guard's path check, so blocked directories and files are left out of listings and search results rather than only being refused as the top-level argument. The guard baseline's secret-path patterns gain `.n-dx.local.json`, the machine-local override file that holds API keys.
