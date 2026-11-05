---
"@n-dx/web": patch
---

The hub session drafts and never acts. It is offered only `run_command`, `draft_github_post`, a new `save_draft` and `ledger_append`; `start_work`, `propose_edit`, `propose_prd_change`, `place_change_card` and `migration_decision` are not offered to it. Its `run_command` takes a project and one of `ndx status`, `git worktree list` (also `--porcelain`) or `git status --short --branch`, each allow-listable per project; any other argv is refused without a card. A GitHub draft names its project and target and posts, on Approve only, under the operator's gh login with cwd at that project's repository root. `save_draft` saves a side-session prompt, restack plan or release checklist at a path shown and editable on its card, writes nothing before Approve, never overwrites a file and is never allow-listable.
