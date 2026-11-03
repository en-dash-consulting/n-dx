---
"@n-dx/core": patch
---

`ndx config web.auth false` now writes `.n-dx.local.json` (and moves a copy out of `.n-dx.json`), since `ndx start` ignores `web.auth: false` in the shared file. `ndx start` also ignores `web.auth: false` from a `.n-dx.local.json` the repository commits, with a warning naming the file; `--no-auth` and `<ndx home>/config.json` still turn it off.
