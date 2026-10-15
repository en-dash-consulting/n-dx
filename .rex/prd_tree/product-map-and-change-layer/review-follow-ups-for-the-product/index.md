---
id: "51a8aed3-0098-43e1-9f84-87c080ababdd"
level: "feature"
title: "Review follow-ups for the product layer work"
status: "pending"
priority: "medium"
tags:
  - "product-map"
  - "follow-ups"
source: "roadmap"
acceptanceCriteria: []
description: "Home for items captured by review passes and runs on the product layer roadmap that are not needed to finish the PR they came from. Captures left under a roadmap feature keep that feature pending, and every feature that depends on it stays blocked, which is what happened after the first overnight wave. Move such items here (rex move <id> --parent=<this feature>) and tag them with the pr-NN they came from. Nothing depends on this feature. Work them as small PRs of their own, or fold one into a later roadmap PR that touches the same files."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-13T19:52:36.022Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [A change's touches and amends name a capability or constraint](./a-change-s-touches-and-amends-name-a.md) | completed |
| [A failed Product refetch replaces the loaded map and an open capability page with an error](./a-failed-product-refetch-replaces-the.md) | pending |
| [A kept v2 completion's commit commands sweep the operator's pre-run edits into the task's commit](./a-kept-v2-completion-s-commit-commands.md) | pending |
| [An open fix: true change that adds a capability marks the new capability defective while its kind is feature](./an-open-fix-true-change-that-adds-a.md) | completed |
| [Apply refuses removing one member of a pre-existing dependsOn knot that stays cyclic](./apply-refuses-removing-one-member-of-a.md) | pending |
| [Bitbucket token patterns in redact.ts are tested only against samples built from the patterns themselves](./bitbucket-token-patterns-in-redact-ts.md) | completed |
| [Bulk PATCH /api/rex/items/bulk writes fields the single PATCH refuses](./bulk-patch-api-rex-items-bulk-writes.md) | pending |
| [Bundle v2 round trip moves unknown state.yaml keys into node frontmatter](./bundle-v2-round-trip-moves-unknown.md) | completed |
| [change-management guide says rex remove archives items and rex restore <item-id> recovers them; neither is true](./change-management-guide-says-rex.md) | completed |
| [Codex drops most of packages/web/AGENTS.md: root plus nested AGENTS.md exceeds its 32 KiB combined project-doc budget](./codex-drops-most-of-packages-web.md) | pending |
| [Codex never sees the per-package governance or the path-scoped rules, because they live only in Claude-loaded files](./codex-never-sees-the-per-package.md) | cancelled |
| [Dashboard file watchers have no 'error' listener, so a watcher error crashes ndx start](./dashboard-file-watchers-have-no-error.md) | pending |
| [Decide whether rex's trailer reader recovers a split-off N-DX-Item line](./decide-whether-rex-s-trailer-reader.md) | pending |
| [Defer the PRD timeline view and re-scope it to the Changes view](./defer-the-prd-timeline-view-and-re.md) | completed |
| [Derive area links and propose dependsOn from shared tests](./derive-area-links-and-propose.md) | pending |
| [Diff two migration plans in words](./diff-two-migration-plans-in-words.md) | pending |
| [Frontmatter parser turns a literal backslash-n in a quoted string into a newline](./frontmatter-parser-turns-a-literal.md) | completed |
| [hench task-lookup.ts imports @n-dx/rex directly, bypassing rex-gateway](./hench-task-lookup-ts-imports-n-dx-rex.md) | pending |
| [Install the sv analyze stop handlers before the progress file says running](./install-the-sv-analyze-stop-handlers.md) | completed |
| [MCP Integration guide still says HTTP MCP is single-project until a 0.7.0 hub](./mcp-integration-guide-still-says-http.md) | pending |
| [ndx work --task on a v2 change with tasks claims the change while another worktree holds one of its tasks](./ndx-work-task-on-a-v2-change-with.md) | pending |
| [No test covers the PRD watcher refreshing the cache on product/ or changes/ edits](./no-test-covers-the-prd-watcher.md) | pending |
| [Nothing stops AGENTS.md growing past Codex's 32 KiB project-doc limit, where Codex silently drops the tail](./nothing-stops-agents-md-growing-past.md) | completed |
| [On a v2 tree, edit_item, move_item, merge_items and claim_task reject a display id that get_item accepts](./on-a-v2-tree-edit-item-move-item-merge.md) | pending |
| [Record review decisions as calibration records on the run record](./record-review-decisions-as-calibration.md) | pending |
| [ref-resolves errors on an added amendment placed under a node another open change adds](./ref-resolves-errors-on-an-added.md) | deferred |
| [rex release stamp applies a container change before the changes nested in it](./rex-release-stamp-applies-a-container.md) | pending |
| [Rex watcher stops following a PRD folder that is deleted and recreated while ndx start runs](./rex-watcher-stops-following-a-prd.md) | pending |
| [Stop the timed-out test gate test racing its fake gate startup](./stop-the-timed-out-test-gate-test.md) | completed |
| [The merge-state git test's LF pin is unguarded off Windows: removing it still passes on macOS and Linux](./the-merge-state-git-test-s-lf-pin-is.md) | completed |
| [The v2 writer silently drops a folder's top-level state.yaml keys when the folder loses its last child](./the-v2-writer-silently-drops-a-folder.md) | pending |
| [v2 isolation test misses imports of the core v2 modules and dynamic import() of any v2 module](./v2-isolation-test-misses-imports-of.md) | pending |
| [v2 layer-nesting accepts a change under a change and a task at the changes root](./v2-layer-nesting-accepts-a-change.md) | completed |
| [Wire ndx migrate --plan to write the classified plan](./wire-ndx-migrate-plan-to-write-the.md) | completed |
| [Write Inbox changes to the reserved changes/inbox/ folder, and move them out on placement](./write-inbox-changes-to-the-reserved.md) | completed |
