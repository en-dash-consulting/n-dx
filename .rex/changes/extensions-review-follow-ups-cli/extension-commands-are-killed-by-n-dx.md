---
id: "d287f3f5-da82-4200-b7b2-5a9a580eae94"
type: "task"
title: "Extension commands are killed by n-dx's command timeout (30 minutes, or a project's cli.timeoutMs)"
slug: "extension-commands-are-killed-by-n-dx"
description: "Verdict: must-fix. main() in packages/core/cli.js (around :3803 and :3844) resolves resolveCommandTimeout(command, projectConfig) for any command name, falling back to the 30-minute default, and wraps extension dispatch in withCommandTimeout; on expiry the child is tree-killed and ndx exits 1. Trigger (run): project cli.timeoutMs 1500 and a 5 s bin -> 'Command \"recon\" timed out' exit 1; with no config a long recon batch dies at 30 min. Config is also read from resolveExistingDir(rest), so `ndx recon ../other-repo` applies that repo's settings. Breaks 'exit code passed through' and 'n-dx resolves no project for the extension'. Fix: apply the timeout and the project-config read only to built-in commands."
acceptanceCriteria:
  - "An extension command is never subject to cli.timeoutMs or the default command timeout"
  - "An extension's positional arguments are not used to locate an n-dx project config"
  - "An e2e test with cli.timeoutMs 1000 and a 2 s extension bin exits with the bin's own code"
priority: "high"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
---
