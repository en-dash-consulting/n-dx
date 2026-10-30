---
id: "534debf3-0b82-43af-adf5-be497be7b85f"
type: "task"
title: "C4: helper backend runs a password-manager command for a stored credential"
slug: "c4-helper-backend-runs-a-password"
description: "PR 2. Done-when re-tightened against PR 1's merged code before PR 2 starts. helper entries hold an argv array (op, pass, bw, gopass), run with no shell and a timeout, stdout trimmed and cached per process. Also the C7 command denylist."
acceptanceCriteria:
  - "helper entries hold an argv array run with no shell and a 10 s timeout; trimmed stdout is cached per process; a failing helper reports which entry failed without its stdout"
  - "ndx config credentials.<name> --helper \"<cmd>\" stores a helper entry"
  - "hench's command denylist blocks security find-generic-password and every configured helper's argv[0]"
priority: "medium"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "credential-injection-design"
blockedBy:
  - "2f5ce643-1c49-4c70-ab2c-545f956873df"
---
