---
id: "1e652885-f8f6-46b1-8fdc-f7ab1cc9b050"
type: "change"
title: "Add structured PRD status transition trailer to commit messages"
slug: "add-structured-prd-status-transition"
intent: "When the commit message file is first written during a hench run, start a 5-minute timer. On expiry, if the file has non-empty contents, finalize the commit using the current file contents and then remove the file. The timer must be cancelled if the agent commits or removes the file on its own before expiry, and must not fire after the run has otherwise terminated."
acceptanceCriteria:
  - "Each hench commit that closes a task includes an `N-DX-Status:` trailer with the PRD item id and the from/to status"
  - "Trailer format is parseable by `git interpret-trailers --parse` and round-trips through `git log --format='%(trailers)'`"
  - "PR markdown generator surfaces the closed PRD items by reading `N-DX-Status:` trailers from the branch's commit range — covered by an integration test against a fixture branch"
  - "Trailer is omitted when the run produces no status change (e.g. partial commits, exploratory edits)"
  - "Timer arms exactly once per run when the commit message file is first detected with non-empty initial content"
  - "Timer expiry with a non-empty commit message file commits the staged changes using that message and deletes the file"
  - "Timer is cancelled cleanly if the agent commits or the run terminates before expiry"
  - "Timer duration is configurable via hench config with a 5-minute default"
  - "Integration test simulates an idle agent and verifies the auto-commit fires at the configured timeout"
amends: [{"target":"e22db08b-4465-4fe8-ad4c-e9f99fc8b259","delta":"modified","summary":"Add structured PRD status transition trailer to commit messages","base":"af68b806ea35a7f3dd4ad9b62ea3411cb3e1b885e75b3b4c1679b0b0cd5808b9"}]
priority: "high"
tags:
  - "hench"
  - "commit"
  - "prd"
  - "pr-markdown"
  - "reliability"
source: "smart-add"
---
