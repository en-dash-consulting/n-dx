---
"@n-dx/sourcevision": patch
---

`sv pack add --from` refuses a bundle that inflates past 512 MiB as "not a usable pack bundle" instead of running out of memory.
