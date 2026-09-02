---
"@n-dx/hench": patch
---

Bound the context handed to a task: `--context-file`, sibling lists, inherited
requirements, and `workflow.md`.

A brief is rebuilt and re-sent for every task and every retry, so anything
unbounded in it is a cost multiplied by the whole loop — and three of its
sections grew with the *project* rather than with the task. Sibling lists are
now capped at 20 and inherited requirements at 25, `workflow.md` is trimmed at
4,000 characters, and `--context-file` — read straight off disk with no bound,
while `ndx work` pipes the entire CONTEXT.md plus PRD tree through it — is
trimmed at 24,000 characters with a warning naming the file.

Inherited requirements are also deduplicated. `collectRequirements` walks the
whole parent chain, so a constraint restated at several levels arrived once per
level; the nearest-parent copy is kept, since its attribution is the more
specific one.

Every cap reports what it dropped, with the omitted count and the total. That
matters more here than the numbers: an agent that cannot tell an absent
constraint from an unmentioned one will confidently act as though it does not
exist. `workflow.md` is trimmed at a line boundary for the same reason — a
mid-line cut would turn "do not delete X" into a complete-looking different
rule.
