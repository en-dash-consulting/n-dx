---
id: "912477b2-d98f-4367-a8c3-f7bc328e9c02"
level: "feature"
title: "Prepare task: run one task from Work with every ndx work option visible"
status: "pending"
priority: "high"
tags:
  - "0.8.0"
  - "task-prep"
  - "phase-1"
acceptanceCriteria: []
description: "Dashboard users cannot do what a terminal user does with `ndx work`. POST /api/hench/execute accepts only `{taskId}` and always runs `ndx work --task=<id> --auto <dir>`, so model, review, permission mode, test gate, budgets, fresh session and allow-dirty can only be changed as saved project config, and none of the seven Start buttons shows which model will run. This feature adds a \"Prepare task\" modal on the Work page: every per-task `ndx work` option, filled in with the value hench would use and where that value came from, editable for one run, with a preflight check list, the equivalent terminal command, a brief preview, and Execute. Start lives in Work; Stop stays in Live, so Execute hands off to /live/task/:id.\n\nPrinciples: (1) hench reports the defaults (`ndx work --resolve`); the dashboard never re-derives them. (2) Every modal state maps to one `ndx work` command line, shown with a Copy button. (3) Anything that would make the run refuse is shown before Execute.\n\nPhase 1 scope: the resolve mode, run options on execute (allow-listed, carried through the hub queue), prep/preview/ready routes, the modal, a Ready to run list, every existing Start button opening the modal (one-click \"Start now\" kept as a secondary menu item), the queued state, and parity fixes: blocked tasks are no longer offered, in-progress tasks with no live run can be resumed, Epic-by-Epic is hidden, Self-Heal gets --auto, and the PRD view keeps the /p/<id>/ prefix.\n\nOut of scope (later phases): saving settings on the task (a `run` field honoured by the CLI), per-task model recommendations (tiers from task size), the Run queue panel for --loop/--epic/--epic-by-epic.\n\nBuilds on #500 (shared available-memory reading): hub admission and /api/live now carry `availableBytes` and `pressure`, and an unknown reading admits. Use those fields; do not read os.freemem()."
lastModified: "2026-10-02T04:54:24.901Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [A late brief preview reopens itself after Back, and switching form/preview drops focus](./a-late-brief-preview-reopens-itself.md) | pending |
| [A malformed PRD makes --resolve exit 1 with no JSON, so the dashboard gets nothing to show](./a-malformed-prd-makes-resolve-exit-1.md) | pending |
| [A queued run whose options its server refuses at replay disappears without telling anyone](./a-queued-run-whose-options-its-server.md) | in_progress |
| [Accept allow-listed run options on POST /api/hench/execute and carry them through the hub queue](./accept-allow-listed-run-options-on.md) | completed |
| [Add `ndx work --resolve`: print the resolved run settings, their sources and any refusals as JSON without running](./add-ndx-work-resolve-print-the.md) | completed |
| [Add the prep routes: GET /api/hench/prep/:taskId, POST /api/hench/prep/:taskId/preview and GET /api/hench/ready](./add-the-prep-routes-get-api-hench-prep.md) | completed |
| [An open Prepare task modal follows the host's next-task prop, so Execute can start a different task than the one prepared](./an-open-prepare-task-modal-follows-the.md) | completed |
| [Any website the user has open can make the dashboard spawn ndx processes through the prep and ready GETs](./any-website-the-user-has-open-can-make.md) | pending |
| [Brief preview with Fresh ticked deletes the orientation session cache](./brief-preview-with-fresh-ticked.md) | pending |
| [Build the Prepare task modal: defaults with sources, per-run overrides, preflight, equivalent command, brief preview and Execute](./build-the-prepare-task-modal-defaults.md) | completed |
| [Copied ndx work commands are not runnable: an unquoted notes placeholder and POSIX-only quoting](./copied-ndx-work-commands-are-not.md) | pending |
| [Escape in the Prepare task modal also closes the PRD detail panel underneath](./escape-in-the-prepare-task-modal-also.md) | pending |
| [GET /api/hench/ready blocks the dashboard's event loop for seconds per refresh](./get-api-hench-ready-blocks-the.md) | completed |
| [GET /api/hench/ready?limit=1e9 returns one row instead of the maximum](./get-api-hench-ready-limit-1e9-returns.md) | pending |
| [Hub queue types and responses drifted from run options, and the unscoped queue exposes other projects' notes](./hub-queue-types-and-responses-drifted.md) | pending |
| [Keep llm.<vendor>.reviewModel and llm.reviewModel in the loaded LLM config](./keep-llm-vendor-reviewmodel-and-llm.md) | pending |
| [Keep the /p/<id>/ and /w/<key>/ prefix when the PRD view rewrites the URL](./keep-the-p-id-and-w-key-prefix-when.md) | completed |
| [`ndx work --resolve=<value>` starts a real run instead of resolving](./ndx-work-resolve-value-starts-a-real.md) | pending |
| [New styles use undefined tokens --text-secondary and --danger, failing light-theme contrast](./new-styles-use-undefined-tokens-text.md) | pending |
| [Open the Prepare task modal from every existing Start button and retire the PRD panel's separate Execute path](./open-the-prepare-task-modal-from-every.md) | completed |
| [Pass --auto when the dashboard starts Self-Heal](./pass-auto-when-the-dashboard-starts.md) | completed |
| [Prep resolve and preview refuse every deferred task, so no Start button can start one](./prep-resolve-and-preview-refuse-every.md) | completed |
| [Ready to run lists stuck tasks first, though ndx work --auto skips them](./ready-to-run-lists-stuck-tasks-first.md) | pending |
| [--resolve omits review-optional from its options, and its command drops --mine and --review-optional](./resolve-omits-review-optional-from-its.md) | pending |
| [--resolve reports no reviewer model unless --review is passed, so the modal cannot show who reviews](./resolve-reports-no-reviewer-model.md) | pending |
| [Several new tests would still pass with the behaviour they name reverted](./several-new-tests-would-still-pass.md) | pending |
| [Show a Ready to run list on the Work page and hide the Epic-by-Epic panel](./show-a-ready-to-run-list-on-the-work.md) | completed |
| [Start now and Ready to run queued notices never learn the run was dropped](./start-now-and-ready-to-run-queued.md) | pending |
| [Starting a run from a Workspaces card opens Live in the viewer's workspace, not the card's](./starting-a-run-from-a-workspaces-card.md) | completed |
| [The context-notes temp file is left behind on spawn failure, write failure and shutdown](./the-context-notes-temp-file-is-left.md) | pending |
| [The dashboard Self-Heal --auto change has no changeset](./the-dashboard-self-heal-auto-change.md) | pending |
| [The Live idle card and Workspaces cards never offer Resume for an in-progress task](./the-live-idle-card-and-workspaces.md) | pending |
| [tokenBudget has no upper bound, so a huge value runs with a budget of 1](./tokenbudget-has-no-upper-bound-so-a.md) | pending |
| [Two near-simultaneous execute requests for the same task both spawn a run](./two-near-simultaneous-execute-requests.md) | pending |
