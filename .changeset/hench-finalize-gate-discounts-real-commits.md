---
"@n-dx/hench": patch
---

fix(hench): the completion gate discounts only what the commit prompt will actually commit

Two follow-ups from the #370 review of the uncommitted-work gate (#363):

- Staged work was discounted whenever `autoCommit` was off, on the theory that
  the commit prompt would land it. But the prompt only commits when a non-empty
  `.hench-commit-msg.txt` exists — an agent that ran `git add -A` and never
  wrote the message passed the gate with every path staged, the PRD recorded
  `completed`, and nothing was committed. The gate now discounts the index only
  when that message file is present with content.
- Reviewer repairs were discounted only on the autoCommit path, although
  `--review` runs regardless of it. With the default `autoCommit=false` the
  reviewer's unstaged edits failed the gate, the completion was withdrawn, and
  the executor's staged work never landed either. Repairs are now discounted
  whenever the review produced a usable report, and the commit prompt stages
  them before `git commit -F` so they ride the executor's commit — the promise
  the reviewer prompt already made.
