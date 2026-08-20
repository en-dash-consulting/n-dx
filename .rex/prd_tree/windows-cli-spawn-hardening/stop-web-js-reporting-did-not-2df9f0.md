---
id: "2df9f0b3-e7f0-4cfc-8524-c1ebf6d78fc4"
level: "task"
title: "Stop web.js reporting \"did not exit\" from a kill result cli.js deems unknowable"
status: "pending"
priority: "low"
tags:
  - "pr-329-followup"
  - "core"
  - "process-lifecycle"
  - "logging"
source: "PR #329 review comment 3816985333 (ryrykeith)"
acceptanceCriteria:
  - "web.js and cli.js agree on whether terminateTreeByPid's return value is meaningful, with one comment explaining the shared rationale"
  - "`ndx start stop` does not print a 'did not exit' warning for a server that exited but was not yet reaped"
  - "The stop path does not emit contradictory lines (a failure warning immediately followed by 'Stopped ...')"
description: "PR #329 review follow-up (unresolved comment on packages/core/web.js:272).\n\n`packages/core/web.js:271-273` branches on the return value of `terminateTreeByPid()` and logs `Server (PID N) did not exit within Nms of SIGKILL.` The parallel stop path in `packages/core/cli.js:764-768` deliberately discards that same return value, with a comment explaining why: `kill(pid, 0)` succeeds for a zombie (exited, not yet reaped), so \"still signallable\" does not mean \"still running\", and SIGKILL is unblockable so the process is done in every sense the caller cares about.\n\nBoth cannot be right. As written, `ndx start stop` can print an alarming \"did not exit\" line for a server that exited cleanly but has not yet been reaped — a false negative on a successful stop, immediately followed by the `Stopped ...` line on web.js:275, which is its own contradiction.\n\nPick one story and make both call sites tell it: either reword the web.js line so it does not claim the process is still running, or drop the branch and match cli.js. If the branch stays, the cli.js comment needs to change to explain when the result *is* meaningful."
---
