---
id: "c5b7fa3b-b349-48e8-a446-68dff057c2ef"
type: "change"
title: "Sandbox agent child processes"
slug: "sandbox-agent-child-processes"
intent: "The command allowlist contains node, npm and npx, so it bounds accidents, not adversaries, and on the Claude CLI path there is no OS sandbox at all. Add guard.sandbox (default on) with one backend per OS that confines hench's tool children and the spawned vendor CLI to the project directory plus a private tmp, with no HOME and no network except the vendor endpoint. Keep Codex's workspace-write sandbox. See the security advisory."
acceptanceCriteria:
  - "guard.sandbox defaults to on and wraps run_command and git children in the API loop and the spawned claude process on the CLI path with the same policy: read/write only realpath(projectDir) and a private tmp, no HOME, no credential directories, no network except the configured vendor endpoint host, git hooks path forced to /dev/null"
  - "A backend exists for macOS (sandbox-exec), Linux (bwrap or landlock) and Windows (restricted job with network denied), with a per-OS smoke test proving a child cannot read $HOME/.ssh, cannot write outside the project and cannot open a socket"
  - "When no backend is available, --auto, --loop and --epic-by-epic refuse to start unless guard.sandbox is set to off in a user-local file (~/.ndx/config.json or .n-dx.local.json), never from a tracked file"
  - "ndx work prints the effective posture line (sandbox, network, permission mode, trust state) and writes it into the run record"
priority: "critical"
source: "ndx-capture"
---
