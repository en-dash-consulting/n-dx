---
"@n-dx/core": patch
---

The manifest validator refuses a `projectLinks[].path` or `sidecarTab.path` with a `.` or `..` segment, raw or `%2e`, so a link cannot leave `/x/<name>/` (rule `link-dot-segment`).
