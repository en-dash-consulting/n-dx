---
"@n-dx/core": patch
---

`ndx ci` no longer crashes with a stack trace when the architecture-policy scan
selects a source file it cannot read. The step fails with `cannot read <file>:
<error>`, and the report and `--format=json` output are still produced.

Changes a CLI result under the soft freeze: for a selected source file it cannot read, `ndx ci`'s architecture-policy step now reports `ok: false` with a `cannot read <file>: <error>` entry in `violations`, where it previously exited with an uncaught error and no report.
