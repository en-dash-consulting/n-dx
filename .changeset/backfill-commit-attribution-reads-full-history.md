---
"@n-dx/rex": patch
"@n-dx/core": patch
---

Fix `rex backfill-commit-attribution` reading only part of a real repository's history.

The command buffered the whole `git log` body in memory through a bare `execFile`, whose 1 MiB default it outgrew — on this repository's own 3.5 MiB history it reported "could not read git history" and did nothing, a silent no-op. It now runs through core's `git` helper, the same path `change-commits.ts` already uses with a 256 MiB ceiling for exactly this reason, so its `node:child_process` entry drops out of the allowlist.

Two parsing gaps surfaced once it could read the log at all:

- **Only the first trailer per commit was read.** A commit that touches several items carries one `N-DX-Status` trailer per item; this repository's 53 such commits carry 122 trailers between them, so better than half were being dropped. Every trailer is now read.
- **Only the Unicode arrow was matched.** Both `→` and `->` occur in history; the `->` form was skipped entirely.

The body is still scanned rather than handed to git's own `%(trailers:…)` parser, which reads only a message's final paragraph: most of this history puts a blank line between the `N-DX-Status` lines and the closing `Co-Authored-By`, so git classifies them as prose and recognises 3 of the 53 commits. A comment on the parser records that.
