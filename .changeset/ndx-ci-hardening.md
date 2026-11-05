---
"@n-dx/core": patch
---

`ndx ci` no longer crashes with a stack trace when the architecture-policy scan
selects a source file it cannot read. The step fails with `cannot read <file>:
<error>`, and the report and `--format=json` output are still produced.

`ndx ci`'s gateway-imports step now also reports a dynamic `import("<pkg>")` of a
gated package outside its gateway, matching what the domain-isolation policy test
already enforces. On Windows it no longer flags the gateway files and allowlisted
files themselves. A source file or directory it cannot read now fails the step
instead of being skipped.

Changes a CLI result under the soft freeze: for a selected source file it cannot read, `ndx ci`'s architecture-policy step now reports `ok: false` with a `cannot read <file>: <error>` entry in `violations`, where it previously exited with an uncaught error and no report.

Changes a CLI result under the soft freeze: a file that loads a gated package with `import()` outside its gateway now makes the gateway-imports step report `ok: false` with a violation, where it previously passed.

Changes a CLI result under the soft freeze: for a source file or directory it cannot read, the gateway-imports step now reports `ok: false` with a `{ file, message }` entry in `violations`, whose message is `cannot read <path>: <error>` and which has no `line`, where it previously skipped the file and passed.
