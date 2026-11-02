---
"@n-dx/hench": patch
"@n-dx/llm-client": patch
---

Run the agent's `run_command` and `git` children inside an OS sandbox (Seatbelt on macOS, bubblewrap on Linux): read-write to the project and a private scratch directory, read-only to the toolchain, no access to credential directories or hench's own state, and no network unless allowed. On by default; switched off only from the environment (`NDX_SANDBOX=off`), `.n-dx.local.json` or the user config, never from a tracked file. An autonomous run refuses to start when no backend is usable, unless the operator opted out. Each run prints the posture it runs under. The commands hench itself starts from the repository after the agent's turn — the test gate, the post-task tests, the completion check's test command, a requirement's validation command and a cleanup batch's typecheck — run inside the same sandbox, so agent-written tests cannot do in the gate what `run_command` refused; `npm audit` and `npm outdated` stay unconfined because they need the registry and run no project code.
