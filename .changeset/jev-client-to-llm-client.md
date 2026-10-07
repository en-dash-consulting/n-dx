---
"@n-dx/llm-client": patch
"@n-dx/sourcevision": patch
---

The Jev client and its judgment cache move from sourcevision into `@n-dx/llm-client`, so rex can ask judgment-shaped questions without importing a sibling domain package. Behaviour, the cache file location and its format are unchanged. Per-call ledger accounting, which a foundation-tier module cannot reach upward for, is now an injection seam: sourcevision registers its run ledger through `setJevObserver` when `sv analyze` starts.
