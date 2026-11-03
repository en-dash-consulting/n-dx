---
"@n-dx/core": patch
---

`ndx ci` and Claude discovery now tell a local-config classifier failure (hench not built, its timeout, unreadable output) apart from git being unable to answer, instead of pointing every failure at `git safe.directory`. The classifier's output buffer is raised from 1 MB to 64 MB.
