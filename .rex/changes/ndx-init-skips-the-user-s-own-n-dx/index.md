---
id: "ea9ab780-cbe5-4278-af4d-927ada879962"
type: "change"
title: "ndx init skips the user's own .n-dx.local.json cli.claudePath without a word when git cannot answer"
slug: "ndx-init-skips-the-user-s-own-n-dx"
intent: "**Severity:** low · **Verdict:** out-of-scope (pre-existing since 0f47c60f0; surfaced by the adversarial review of 3bc4c88a, run ec290231).\n\n**Failure scenario.** In a work tree where git exits 128 (`detected dubious ownership`: devcontainer, WSL, another uid), `readConfiguredClaudePath` (packages/core/claude-integration.js:489-494) treats the user's untracked `.n-dx.local.json` as tracked via `isGitTrackedOrUnanswered` and returns undefined. `discoverClaudeCli` then falls back to PATH and well-known locations; when none has claude, the not-found `searched` list never mentions the skipped setting or the git failure. Skipping is correct (fail closed); the silence is not. llm-client's trust review now says \"git could not confirm … is untracked\" (3bc4c88a); core does not.\n\n**Reachability.** `ndx init` (claude discovery) in a checkout git refuses, with `cli.claudePath` set in `.n-dx.local.json` for a non-standard install. Narrow.\n\n**Options.** 1 (recommended): have core's check return git's reason (mirror llm-client's `GitTrackAnswer`) and add a `searched` entry / init note naming `cli.claudePath`, that git could not confirm the local file is untracked, and `safe.directory` / `ndx trust accept .`, never the path value. Small. 2: leave as is; the trust review already names the git failure. Related: d59b5373 (same silent-skip shape for a shared cli.claudePath)."
acceptanceCriteria:
  - "With a stub git exiting 128 inside a work tree and cli.claudePath set in .n-dx.local.json, ndx init's claude discovery output names cli.claudePath and says git could not confirm the local file is untracked (test)"
  - "The skipped cli.claudePath is still never executed in that state"
  - "The path value is not printed"
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "low"
discoveredFrom: {"item":"82468601-c666-4943-a9ac-b11bb0149372","run":"ec290231-80e2-44fd-8069-71f791d18a28"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "security"
  - "issue-cleanup"
source: "ndx-adversarial-review"
---
