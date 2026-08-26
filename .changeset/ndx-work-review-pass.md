---
"@n-dx/core": patch
"@n-dx/hench": patch
"@n-dx/llm-client": patch
---

Add `ndx work --review`: an adversarial review pass that runs after a task's
changes validate and before the commit prompt, so must-fix repairs ship in the
same commit as the work they repair.

**`--review` changes meaning; the old gate is now `--approve-diff`.** The flag
previously showed the diff and prompted for approval. That gate is unchanged
apart from its name — pass `--approve-diff` to get it. The two are independent
and compose: the review pass runs first, so a human answering the diff prompt
sees the repaired tree rather than the one the implementer left behind. Runs
that pass `--review` print a line saying where the old behavior went.

**The reviewer resumes the work session.** On the Claude CLI the pass re-enters
the session that just did the work (`--resume <session-id>`, captured from the
`session_id` that `--output-format stream-json` stamps on every line) and runs
it on a stronger model. That inherits what the diff cannot show: which
approaches were tried and abandoned, which files were read and found
irrelevant, what the implementer believed it was doing. Vendors whose CLI has no
resume equivalent — and any run where the session id never arrived — fall back
to a fresh reviewer seeded with the task, its acceptance criteria, and the
change's scope.

Resuming invites anchoring, so the reviewer's system prompt is built against it:
prior reasoning in the conversation is named as evidence under test rather than
a position to defend, and every finding must carry inputs-to-wrong-result
concrete enough to be refuted. Findings that cannot be triggered are dropped
rather than softened.

**Review gets its own model tier, `REVIEW_MODELS`.** Review is read-heavy and
judgment-dense but short — one diff, one pass — so its token volume is a
fraction of the run it audits and a stronger model costs little in absolute
terms. Claude defaults to `claude-opus-5` ($5/$25 per MTok): Opus-tier reasoning
at the same input price as Opus 4.8, where `claude-fable-5` would cost twice as
much for a single pass. Codex and Google resolve to their existing top tier;
local uses whatever is loaded.

Resolution is `--review-model` → `llm.<vendor>.reviewModel` → `llm.reviewModel`
→ the vendor default. `llm.model` and `llm.<vendor>.model` are deliberately
excluded: inheriting the execution model would mean a project that pins a cheap
executor silently gets a cheap reviewer, which defeats the reason the tier
exists. `--review-model` without `--review` is an error rather than a no-op.

**Findings are triaged, not just listed.** Autonomous runs apply the verdict
policy directly — `must-fix` is repaired in-session with the test that would
have caught it, `should-fix` and `out-of-scope` are captured as rex items after
checking `.rex/prd_tree/` for an existing item describing the same defect, and
`not-worth-fixing` is reported with its reason. Interactive runs still stop and
ask before writing anything to the PRD. The reviewer is barred from committing,
from changing task status, and from any command that rewrites analysis or PRD
state concurrently with the run.

**A broken review never fails a valid task.** By the time the pass runs, the
task's own completion validation has already passed, so a reviewer that dies,
writes nothing, or writes something unparseable tells us nothing about the work
— the failure is reported and the run continues. The distinction is preserved
on the run record (`run.review`) rather than left in terminal scrollback,
because a review that silently did not happen must not read as one that found
nothing. Report transport is a JSON file under `.hench/reviews/<run-id>.json`,
keyed by run so a re-review keeps both, and cleared before each pass so a stale
report can never be read as the current one. Unknown enum values in a report
are coerced toward alarm — an unrecognized severity becomes `critical`, an
unrecognized action becomes `failed` — so a garbled field demands attention
instead of reading as clean.

The pass requires the CLI provider and errors out on `provider=api` rather than
accepting the flag and doing nothing. Its token usage is charged to the run it
reviewed, so `ndx usage` reflects what `--review` actually costs.
