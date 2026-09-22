---
"@n-dx/hench": patch
---

Autonomous `--review` runs park their unanswered findings instead of dropping them

An adversarial review inside `ndx work --auto`/`--loop` offered its should-fix
findings to a capture prompt with nobody at it, then recorded them as `dropped`
— a decision word for a decision nobody made. The findings existed only in
terminal scrollback, and the review record on disk gave nothing downstream a way
to find them.

The run now derives each finding's fate from what the pass actually did (a
repair in the tree, an item id in the PRD, or a `not-worth-fixing` verdict
carrying its own reasoning) and parks everything else as `deferred`, rewriting
the review report so the conclusion outlives the terminal. The end-of-run
summary names the deferred count and the record path, and `hench review pending
<run-id>` lists each parked finding with an id, its severity, verdict and
failure scenario — ready to hand to `/ndx-adversarial-review` for capture.

Interactive runs are untouched: a human was at the prompt, so a declined finding
really was declined.
