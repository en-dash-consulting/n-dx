---
id: "30bd6623-4c94-461d-a4f3-42614114db05"
level: "task"
title: "Append n-dx authorship and vendor/model audit trailer to hench-generated commit messages"
status: "pending"
priority: "high"
tags:
  - "hench"
  - "commit"
  - "attribution"
source: "smart-add"
acceptanceCriteria:
  - "Every commit produced by `ndx work` (interactive, --auto, and --loop modes) ends with an `N-DX:` trailer line that names the vendor and the resolved model id"
  - "When task-weight tiering selects a non-default tier, the trailer records the tier alongside the model (e.g. `claude/claude-opus-4-7 (heavy)`)"
  - "Trailer is omitted when the commit was produced outside hench (manual `git commit`) — verified by integration test"
  - "Trailer survives `git interpret-trailers` parsing as a recognized key/value pair"
description: "Extend the hench commit message builder to add a deterministic trailer block (e.g. 'N-DX: <vendor>/<model> · run <runId>') below the body. Pull vendor and model from the resolved LLMConfig used for the run, including the resolved tier when task-weight tiering is active. The trailer must be stable across runs (no timestamps in the line) so semantic-diff and PR-markdown tooling can recognize it."
---
