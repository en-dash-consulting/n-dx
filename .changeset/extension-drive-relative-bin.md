---
"@n-dx/core": patch
---

Reject a drive-relative extension path such as `D:cli.js` in `bin`, `sidecar.bin` and `configSchema`, as the published schema already did. Dispatch also refuses a command or sidecar bin that resolves outside its package folder.
