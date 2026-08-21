---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
---

Make the tests' `sh`-on-PATH dependency explicit instead of failing opaquely.

`sh` is absent from a stock Windows PATH — it ships with Git for Windows, which Git Bash exposes and PowerShell/cmd.exe do not. Tests that spawn `sh -c` therefore passed from Git Bash and failed from PowerShell on the same commit, and no failure message mentioned a shell: the orphan test reported `expected false to be true` after burning a 5s wait, because the grandchild that never started also never wrote its pid. Two of these were investigated as suspected regressions during a merge before the shell was identified as the variable.

The audit found more than the two files that prompted it: **28 shell-dependent cases across 5 files**, of which 21 were failing and **5 were passing vacuously** — a case asserting "nothing was written after the timeout" is trivially satisfied when nothing ever ran, and hench's `reports exit code on failure without output` is satisfied by a spawn that failed to launch. Those were green on machines where the behaviour was never exercised, which is the worse half of this bug.

Each site now skips with `sh` named, via one helper per suite boundary, all delegating to the production `isExecutableOnPath` probe. The `sh` indirection itself is preserved, not removed: libuv puts every non-detached child it spawns on Windows into a global job object, so spawning `node` directly would reap the tree for free and make the tests vacuous — which is how an earlier version of the orphan test managed to prove nothing.

For hench the skip says more, because there `sh` is not scaffolding: `run_command` and the post-task test runner spawn `sh -c` on *every* platform, so a machine without `sh` cannot run those tools at all. The skip records which product capability went unverified rather than implying a test artifact.

Also: shell spawns in tests no longer discard their own failure. `stdio: "ignore"` is about the child's output, and with the spawn error thrown away an unresolvable shell looked identical to a surviving orphan. Full inventory and the rules for adding a new shell-spawning test are in `tests/shell-spawn-inventory.md`.
