---
"@n-dx/core": patch
---

`web.auth: false` now turns the per-user dashboard token off only from `.n-dx.local.json`, `<ndx home>/config.json` or `--no-auth`. A `false` in the tracked `.n-dx.json` is ignored, with a warning naming the file.
