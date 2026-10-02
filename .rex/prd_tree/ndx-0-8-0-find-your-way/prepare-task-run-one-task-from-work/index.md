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
| [Accept allow-listed run options on POST /api/hench/execute and carry them through the hub queue](./accept-allow-listed-run-options-on.md) | completed |
| [Add `ndx work --resolve`: print the resolved run settings, their sources and any refusals as JSON without running](./add-ndx-work-resolve-print-the.md) | completed |
| [Add the prep routes: GET /api/hench/prep/:taskId, POST /api/hench/prep/:taskId/preview and GET /api/hench/ready](./add-the-prep-routes-get-api-hench-prep.md) | pending |
| [Build the Prepare task modal: defaults with sources, per-run overrides, preflight, equivalent command, brief preview and Execute](./build-the-prepare-task-modal-defaults.md) | pending |
| [Keep llm.<vendor>.reviewModel and llm.reviewModel in the loaded LLM config](./keep-llm-vendor-reviewmodel-and-llm.md) | pending |
| [Keep the /p/<id>/ and /w/<key>/ prefix when the PRD view rewrites the URL](./keep-the-p-id-and-w-key-prefix-when.md) | completed |
| [Open the Prepare task modal from every existing Start button and retire the PRD panel's separate Execute path](./open-the-prepare-task-modal-from-every.md) | pending |
| [Pass --auto when the dashboard starts Self-Heal](./pass-auto-when-the-dashboard-starts.md) | completed |
| [Show a Ready to run list on the Work page and hide the Epic-by-Epic panel](./show-a-ready-to-run-list-on-the-work.md) | pending |
