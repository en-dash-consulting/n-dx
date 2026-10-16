---
"@n-dx/core": patch
---

`ndx ci` no longer crashes with a stack trace when the architecture-policy scan
selects a source file it cannot read. The step fails with `cannot read <file>:
<error>`, and the report and `--format=json` output are still produced.
