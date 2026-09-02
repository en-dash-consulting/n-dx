---
id: "30bd6623-4c94-461d-a4f3-42614114db05"
level: "task"
title: "Append n-dx authorship and vendor/model audit trailer to hench-generated commit messages"
status: "completed"
priority: "high"
tags:
  - "hench"
  - "commit"
  - "attribution"
source: "smart-add"
startedAt: "2026-04-29T19:03:10.292Z"
completedAt: "2026-04-29T19:17:11.656Z"
endedAt: "2026-04-29T19:17:11.656Z"
resolutionType: "code-change"
resolutionDetail: "Implemented N-DX authorship trailer that appends vendor, model, run ID, and optional weight to commit messages. Extended RunRecord schema, updated InitRunOptions, and added trailer generation in performCommitPromptIfNeeded. Added comprehensive integration tests verifying format, weight display, and git compatibility. All acceptance criteria met."
acceptanceCriteria:
  - "Every commit produced by `ndx work` (interactive, --auto, and --loop modes) ends with an `N-DX:` trailer line that names the vendor and the resolved model id"
  - "When task-weight tiering selects a non-default tier, the trailer records the tier alongside the model (e.g. `claude/claude-opus-4-7 (heavy)`)"
  - "Trailer is omitted when the commit was produced outside hench (manual `git commit`) — verified by integration test"
  - "Trailer survives `git interpret-trailers` parsing as a recognized key/value pair"
description: "Extend the hench commit message builder to add a deterministic trailer block (e.g. 'N-DX: <vendor>/<model> · run <runId>') below the body. Pull vendor and model from the resolved LLMConfig used for the run, including the resolved tier when task-weight tiering is active. The trailer must be stable across runs (no timestamps in the line) so semantic-diff and PR-markdown tooling can recognize it."
---
