---
id: "16015ed9-d730-417e-a5ca-22c073a934b6"
type: "capability"
title: "One-click labelled commit when the dirty tree is only PRD or only scan output"
slug: "one-click-labelled-commit-when-the"
statement: "Closing a ticket from the dashboard saves the status change, and any parent auto-completion it implies, to the PRD folder tree, so `ndx loop` continues past the closed task without stopping."
criteria: [{"id":"c1","text":"When a ticket is closed from the dashboard, the dashboard shall persist the status change to `.rex/prd_tree/<slug>/index.md` so that a fresh process reads the new status."},{"id":"c2","text":"When closing a ticket from the dashboard implies a parent auto-completion, the dashboard shall persist that parent's completed status to the PRD folder tree."},{"id":"c3","text":"When a ticket has been closed from the dashboard, `ndx loop` shall run to completion without stopping and without re-selecting the closed task."},{"id":"c4","text":"The dashboard shall persist a ticket close-out to the PRD folder tree whether or not fail-forward mode is on."}]
tags:
  - "web"
  - "git"
  - "prd"
  - "sourcevision"
  - "feature-toggle"
source: "ndx-capture"
priority: "medium"
---

When the only uncommitted files are PRD files, offer a button that commits them with a message describing the PRD change. Same for a SourceVision scan's output. Add a setting that does it automatically instead of on click.

What already exists — reuse it, do not rebuild:
- `packages/web/src/viewer/components/git-status-banner.ts` is the bottom-right "N uncommitted files" pill expanding into a panel with per-file rows, lazy diffs, a commit-message textarea, "Stage All & Commit", "Discard…" and per-file "Ignore".
- `packages/web/src/viewer/hooks/use-git-status.ts` polls `GET /api/git/status` every 15s.
- `packages/web/src/server/routes-git.ts` serves status (`:146`), diff (`:171`), commit (`:229-235`), discard and ignore.

What is missing:
1. **Classification.** Nothing groups dirty paths by origin. The banner shows a flat list.
2. **Scoped staging.** `POST /api/git/commit` runs `git add -A` (`routes-git.ts:229`), so it cannot produce a PRD-only commit. A pathspec-scoped staging path is required, and it must not sweep in unrelated work — the same reason the n-dx skills name their paths explicitly rather than using `git add -A`.
3. **The toggle.** `FEATURE_REGISTRY` (`packages/web/src/server/routes-features.ts:43`) renders generically from the registry, so a new boolean key needs no new UI file; `views/feature-toggles.ts` picks it up. Use `isFeatureEnabled` server-side so the automatic path fails closed.

Motivating pain, worth stating because it is the reason this keeps coming up: `.sourcevision/` outputs are tracked — `.sourcevision/.gitignore` is `*` with un-ignores for about ten files including `inventory.json`, `imports.json`, `zones.json` and `CONTEXT.md` — and `git status --porcelain` runs in `routes-git.ts` with no pathspec exclusion. So every dashboard-triggered analyze dirties the tree, inflates the uncommitted count in the banner, the sessions panel and the breadcrumb chip, and trips hench's pre-run dirty-tree gate (`performPreRunCommitGateIfNeeded`, `packages/hench/src/agent/lifecycle/shared.ts`).

Prior art in the PRD to check against before designing, so this does not duplicate or contradict it: `cli-developer-tools/auto-commit-on-completion-for-file` and `cli-developer-tools/commit-time-prd-status-transition`.

Open question for the implementer, not a decision to make here: whether an automatic commit should carry the `N-DX:` trailer block the way skill and hench commits do, and if so what the `N-DX-Item` value is for a scan that belongs to no item.
