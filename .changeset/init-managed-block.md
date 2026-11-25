---
"@n-dx/core": patch
---

`ndx init` now keeps your own text in CLAUDE.md and AGENTS.md and rewrites only its block between `<!-- ndx:begin … -->` and `<!-- ndx:end -->`.

Action needed: a CLAUDE.md or AGENTS.md written by an earlier `ndx init` has no markers, so re-running init keeps that whole old file and adds the new block after it. Delete the old generated text (or the file) and run `ndx init` again.

With no file, init writes just the block. A file that already has the markers gets only the text between them replaced; everything before and after stays byte-identical. A file without markers keeps all of its text and gets the block appended. Running init twice in a row changes nothing the second time. The "do not edit manually" note now sits on the begin marker, so it covers only the generated block.
