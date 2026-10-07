---
"@n-dx/rex": patch
"@n-dx/core": patch
---

v2 trees on a Windows CRLF checkout: the reader loads a CRLF file into the same model as its LF copy (bodies included), and the v2 writer and `state.yaml` writer leave a file alone when it differs only by CRLF. `ndx init` now pins `<rexDir>/**/*.yaml` (the v2 `state.yaml` files) to LF.
