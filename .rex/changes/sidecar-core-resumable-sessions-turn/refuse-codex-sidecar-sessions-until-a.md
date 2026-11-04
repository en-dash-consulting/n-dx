---
id: "b054ee8e-054a-4e91-bda8-36d8aceff063"
type: "task"
title: "Refuse Codex Sidecar sessions until a resumed turn keeps the read-only sandbox"
slug: "refuse-codex-sidecar-sessions-until-a"
description: "#901 F1 (high, must-fix). A Codex Sidecar session is read-only only on its first turn. vendor-session-driver.ts builds the resume argv as `codex exec resume <id> --json --skip-git-repo-check -` with no policy flags, on the assumption (comment at the resume branch, and spawn-policy.ts) that a resumed thread keeps the policy it started with. Per current openai/codex (codex-rs/exec, thread_resume_params_from_config), `exec resume` takes sandbox and approval policy from the invocation's config, so from turn 2 the user's ~/.codex/config.toml decides (for example sandbox_mode = \"workspace-write\") and the session can write the worktree and run commands with no card.\n\nDecided (Ryan, 2026-11-04): option (b). Refuse vendor \"codex\" at session create until resume re-applies the policy. Re-applying it (global -c overrides, or --sandbox before the resume subcommand, verified against a real CLI with a test on the second turn's argv) stays with the carried-over Codex broker item 31307b89. Hench's own Codex resume path has the same argv; that is pre-existing and out of scope here.\n\nSource: Adversarial review by Hal (endash-shal), 2026-11-04 on #901."
acceptanceCriteria:
  - "POST /api/sidecar/sessions with vendor \"codex\" answers 400 with a reason naming that Codex Sidecar sessions are unavailable until a resumed turn keeps the read-only sandbox, and writes no session record"
  - "A Codex session already in the session index is refused a new turn with the same reason rather than resumed without its sandbox"
  - "The comments in vendor-session-driver.ts and spawn-policy.ts that say a resumed Codex thread keeps its starting policy are corrected and point at 31307b89"
  - "Route tests cover both refusals"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
  - "review:#901-F1"
source: "ndx-adversarial-review"
---
