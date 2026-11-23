---
"@n-dx/core": patch
---

`ndx analyze --fast` no longer checks the npm registry for a newer n-dx, so the static-only batch path (`ndx init --no-llm`, then `ndx analyze --fast`) makes no network request.

`ndx analyze --help` now lists `--fast`. An invented legacy PHP estate fixture and an end-to-end test of that batch path cover PHP detection, include resolution, database tables, legacy construct counts, parse problems, and the absence of model calls, network requests and secret values.
