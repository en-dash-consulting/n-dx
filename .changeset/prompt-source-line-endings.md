---
"@n-dx/core": patch
---

Pin `packages/core/assistant-assets/**/*.md` to LF, so a prompt's measured size
does not depend on which OS checked the repo out.

`.gitattributes` already pins `.claude/skills/**/*.md` — the copies `ndx init`
generates — but not the sources those copies are written from. On a Windows
checkout with `core.autocrlf=true` the sources came out CRLF, one extra byte per
line, which inflated every shipped skill body: `ndx-adversarial-review` measured
20,678 chars against the 20,512 recorded in
`docs/analysis/prompt-token-baseline.md`.

That failed `tests/e2e/prompt-census.test.js` with a 140-token drift no commit
had caused, and the three skills living only in `.claude/skills/` measured
exactly right — the pin was the difference. Because CI runs on LF it never saw
it, so the guard was red on Windows and green in CI on the same commit.

Re-recording the baseline would have been the wrong fix: it would stamp
CRLF-inflated figures into the doc and flip the guard on the next platform
switch. The tree is renormalized to LF instead, which leaves the index unchanged
and stops a Windows publish shipping CRLF skill sources.
