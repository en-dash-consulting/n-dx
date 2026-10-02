---
"@n-dx/hench": patch
---

Tell the agent to run git as a bare command from the project root

Claude CLI pre-approves git one subcommand at a time (`Bash(git add:*)`,
`Bash(git commit:*)`), and those patterns match by prefix only. An agent that
cd'd into a package to run its tests and then committed with `cd ../.. && git
commit …`, `(cd X; git commit)` or `git -C <dir> …` matched none of them, drew a
permission prompt nobody was there to answer, and failed the uncommitted-work
gate on a run whose test gate had passed.

The task brief's commit step now states that git must begin the command line —
never behind `cd … &&`, a subshell, or `git -C` — and that an agent which has
changed directory returns to the project root first. The git allowlist is
unchanged: a prefix rule cannot approve `cd <anything> && git …` without also
approving whatever follows the `&&`.
