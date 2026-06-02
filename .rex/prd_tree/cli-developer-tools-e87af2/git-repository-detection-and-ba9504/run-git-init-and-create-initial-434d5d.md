---
id: "434d5dfb-d98c-4be5-b3fa-8f2c02547628"
level: "task"
title: "Run git init and create initial n-dx commit when user consents during ndx init"
status: "pending"
priority: "high"
tags:
  - "init"
  - "git"
  - "commit"
source: "smart-add"
acceptanceCriteria:
  - "`git init` is executed in the target directory after user consent"
  - "All n-dx-generated files (.sourcevision/, .rex/, .hench/, .n-dx.json) are staged and committed"
  - "Commit message identifies the commit as the n-dx init baseline (e.g. 'chore: n-dx init')"
  - "Init summary output confirms the git repository was created and the initial commit was made"
  - "If `git init` or the commit fails, the error is surfaced clearly and init does not silently continue"
description: "When the user agrees to git initialization in the preflight prompt, run `git init`, stage the newly created n-dx tool directories (.sourcevision, .rex, .hench), and create an initial commit with a standard message indicating the n-dx init baseline. The commit should be created after all tool directories are written so the snapshot is complete."
---
