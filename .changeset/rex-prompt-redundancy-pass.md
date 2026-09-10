---
"@n-dx/rex": patch
"@n-dx/core": patch
---

Remove instructions that rex prompts already gave elsewhere in the same prompt,
and resolve a task-size contradiction between them.

`TASK_QUALITY_RULES` sized a task at "one focused session (1-4 hours)" while
`PRD_SCHEMA` asked for `loe` in engineer-weeks, `CONSOLIDATION_INSTRUCTION` asked
for 0.5–4 engineer-week tasks, and decomposition splits anything over
`taskThresholdWeeks: 2`. Nine builders carried the hours figure; eight of those
also carried a weeks figure. `buildAssessmentEnvelope` — the prompt that decides
whether to split or merge a proposal — graded week-scale work against the same
hour-scale bar, so it recommended `break_down` on correctly-sized tasks. Sizing
is now stated in engineer-weeks everywhere.

Deleted as duplicated within the prompt that contained them: the markdown-fence
prohibition (already in `OUTPUT_INSTRUCTION`), the "tasks need a description and
criteria" and "no vague titles" rules (already in `TASK_QUALITY_RULES`, and
restated twice more in `consolidation-guard` and `decompose`), the existing-PRD
duplicate rule (kept in `ANTI_PATTERNS`, which reaches every prompt that had
both), and `AUTO_PLACEMENT_INSTRUCTION`'s restatement of what `existingId` does.
No instruction was removed from a prompt that did not still state it.

Measured with `scripts/prompt-census.mjs`: rex drops from 16,121 to 15,217
per-call tokens and 7,473 to 7,195 unique, a monorepo total of -904 / -278. A new
`prompt-non-redundancy.test.ts` suite pins each rule against reintroduction, and
both prompt suites now share one fixture list so a new prompt cannot be covered
by one and missed by the other.

Also adds `.hench/session-cache.json` to the `ndx init` ignore template, matching
this repo's own `.gitignore`.
