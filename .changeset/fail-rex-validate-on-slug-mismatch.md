---
"@n-dx/rex": patch
---

`rex validate`'s "tree slug convention" check is now an error, not a warning: a PRD tree written by a foreign slug rule means the next write will rewrite it, so it must fail validation and CI rather than pass silently. The check now also names the offending paths and points at `rex migrate-slugs`.
