---
"@n-dx/core": patch
---

`ndx export` resolves the rex CLI from the installed package instead of spawning a bare `rex` from PATH. Without a globally linked binary the export failed at "pre-rendering PRD data" with `spawn rex ENOENT` before publishing any run record — in every clean install and in CI.
