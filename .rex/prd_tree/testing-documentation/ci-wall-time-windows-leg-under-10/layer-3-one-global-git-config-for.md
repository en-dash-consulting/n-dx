---
id: "dd005409-bef7-4017-a5b2-b625e2f70409"
level: "task"
title: "Layer 3 · One global git config for every fixture repo"
status: "pending"
priority: "medium"
source: "ndx-capture"
acceptanceCriteria:
  - "initGitFixtureRepo spawns exactly one git process"
  - "Shell-spawn inventory policy test passes with its inventory updated if git spawn counts are tracked"
description: "tests/setup-session-env.js writes a per-process gitconfig (user.name, user.email, core.autocrlf=false, core.eol=lf, commit.gpgsign=false, core.hooksPath to an empty dir) and exports GIT_CONFIG_GLOBAL and GIT_CONFIG_NOSYSTEM=1. hench's initGitFixtureRepo and its sync twin drop to a bare git init. Follow-up commit strips per-repo git config user.* calls from the 38 test files that make them."
lastModified: "2026-10-12T14:51:55.328Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
