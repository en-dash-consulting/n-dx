---
id: "7a64e00f-8aea-4687-9f4f-b17795f95282"
type: "change"
title: "`ndx ci`'s config-secrets step reads a case-variant or symlinked committed local config as clean and advises git rm --cached on the wrong path"
slug: "ndx-ci-s-config-secrets-step-reads-a"
intent: "Out-of-scope finding from the adversarial review of 47654649 (run a8a2aa5b), pre-existing code in packages/core/ci.js. Verdict: out-of-scope (real, pre-existing).\n\nScenario: a repository commits `.N-DX.local.json` (on a case-insensitive filesystem n-dx opens it as `.n-dx.local.json`), or commits a symlinked `.ndx -> cfg` with `cfg/config.local.json`. checkConfigSecrets (packages/core/ci.js ~1440-1465) asks isGitTracked only about `projectConfigLabel(dir, LOCAL_CONFIG_FILE)`, the path n-dx opens. git matches a pathspec by exact case and lists nothing beyond a symlink, so the step reports the file as untracked. The keys `ndx config` writes there are committed, and nothing reports it. When the step does fire, its advice `git rm --cached <localFile>` names the opened path, which does not match a case variant or a symlinked shape.\n\nReachable: `ndx ci .` in any checkout that commits the local file under those shapes.\n\nOptions: (a) spawn the same check llm-client uses (`isLocalConfigTracked` / the git-matched paths now in RepoExecutionConfig.localConfigTrackedPaths), e.g. through `hench trust status`, since core spawns rather than imports. Recommended, because it keeps one definition of \"tracked\". (b) Reimplement in ci.js: an icase literal pathspec plus symlinked-dir and realpath candidates. That duplicates logic that can drift."
acceptanceCriteria:
  - "`ndx ci .` fails the config-secrets step for a committed `.N-DX.local.json` on a case-insensitive filesystem"
  - "`ndx ci .` fails the config-secrets step for `config.local.json` reached through a committed symlinked `.ndx`"
  - "The step's `git rm --cached` advice names the paths git tracks (case variant as committed; symlink and target)"
  - "tests/e2e/cli-ci.test.js covers both shapes"
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "low"
discoveredFrom: {"item":"47654649-c6f7-4277-a156-d5d606f9ed2c","run":"a8a2aa5b-e622-4998-bfc7-68c8ba95b6ed"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "security"
  - "issue-cleanup"
source: "ndx-adversarial-review"
---
