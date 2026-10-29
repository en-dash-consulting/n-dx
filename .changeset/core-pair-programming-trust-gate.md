---
"@n-dx/core": patch
---

`ndx pair-programming` reads the repository's test command and a tracked vendor `cli_path` only from a trusted checkout: `readRexTestCommand` returns undefined with the same note `verify_criteria` prints while the repository is restricted, and `resolveVendorCliPath` honours `.n-dx.local.json` always but `.n-dx.json` only once trusted. Both are now async; `ndx trust` help describes the wider digest.
