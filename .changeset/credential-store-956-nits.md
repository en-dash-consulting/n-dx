---
"@n-dx/core": patch
"@n-dx/llm-client": patch
"@n-dx/web": patch
---

Credential store review nits: the landing page re-enables Initialize after a failed Google key store; the Claude scrub warning is Claude-only and no longer names GitHub tokens; a refused Windows credential-CLI spawn prints one line; `ndx config credentials --import` without a terminal exits 1 when a different stored key blocks a vendor.
