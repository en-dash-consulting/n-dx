---
id: "598d6fd3-86d0-42d2-8a41-1030963777ef"
level: "task"
title: "Smart Add Command Regression Fix"
status: "completed"
source: "smart-add"
startedAt: "2026-03-06T16:45:34.740Z"
completedAt: "2026-03-19T15:03:54.710Z"
resolutionType: "acknowledgment"
resolutionDetail: "All children completed; pending tasks moved to new CLI epic"
description: "The `ndx add` orchestration command currently throws a 'missing .rex' error instead of delegating to `rex add` as expected. The fix should ensure `ndx add` spawns the rex CLI with the correct arguments and working directory, matching the behavior documented in CLAUDE.md."
---

## Subtask: Identify and fix smart-add command name mismatch between web UI and rex CLI

**ID:** `aed32a03-80d2-41de-b9e5-cafdd0d1f400`
**Status:** completed
**Priority:** critical

The Rex Dashboard Smart Add box triggers an API call to the rex CLI using the subcommand 'smart-add', but the CLI no longer registers that name — likely renamed or restructured during a prior refactor. Trace the full call path from the web UI input handler through the web server API route to the rex CLI invocation, identify the correct current command name (e.g. 'add --smart' or similar), and update the web server route or API client to use the correct invocation. Verify the fix does not break the CLI's own smart-add entry point if it is invoked directly.

**Acceptance Criteria**

- Typing in the Smart Add box in the Rex Dashboard no longer produces an 'Unknown command' error at any character count
- Proposal generation triggers successfully and returns results in the Smart Add panel
- The rex CLI 'rex --help' output confirms the invoked subcommand or flag exists
- No regression in the CLI smart-add workflow when invoked directly from the terminal
- Web server API route for smart-add returns a 200-range response with proposal data

---

## Subtask: Add integration test covering Smart Add web-to-CLI command dispatch

**ID:** `133f2af9-e07d-4470-8bb8-c28cd51ac8e1`
**Status:** completed
**Priority:** high

There is currently no test that exercises the full web UI → web server → rex CLI invocation path for the smart-add feature, which allowed a command name regression to ship undetected. Add an integration test that confirms the web server's smart-add endpoint constructs and dispatches the correct CLI command, and that a well-formed response is returned when the rex package handles the request.

**Acceptance Criteria**

- Integration test exists that mounts the web server smart-add route and asserts the correct rex command is invoked
- Test fails when the command name is set to 'smart-add' (reproducing the bug) and passes with the correct command
- Test is added to the standard CI test suite and runs without additional setup
- Test covers at least one happy-path proposal response and one error case (invalid input)

---
