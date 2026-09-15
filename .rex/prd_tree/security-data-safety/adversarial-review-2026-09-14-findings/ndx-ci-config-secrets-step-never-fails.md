---
id: "b53574ad-4e8f-415d-a4d1-8c6595163750"
level: "task"
title: "`ndx ci` config-secrets step never fails on a git-tracked `.n-dx.local.json`"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "security"
  - "severity:low"
  - "core"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "`ndx ci --format=json` reports `config-secrets` with `ok: false` when `.n-dx.local.json` is tracked by git, regardless of its contents"
  - "The step detail names `.n-dx.local.json`, says it must be gitignored, and tells the user to `git rm --cached` it and rotate any key it held"
  - "`ndx ci` still passes when `.n-dx.local.json` exists but is untracked"
  - "`tests/e2e/cli-ci.test.js` gains a tracked-local-file case alongside the existing three"
description: "**Severity:** low · **Verdict:** should-fix · **Gap in commit 7c222329 (this branch)**\n\n**Failure scenario.** `checkConfigSecrets` (`packages/core/ci.js`) scans only the shared `.n-dx.json` for `api_key` leaves and consults git tracking only for that file. After this branch, every API key `ndx config` writes lands in `.n-dx.local.json`, whose safety rests entirely on the `.gitignore` entry. A user who trims `.gitignore`, adds `!.n-dx.local.json`, or force-adds the file commits every vendor key, and `ndx ci` reports `config secrets ✓ (no API keys in .n-dx.json)`. The step's stated purpose — no committed API key — is unmet for the one file that now holds them all.\n\n**Refutation attempted.** Looked for any reference to `LOCAL_CONFIG_FILE` or `.n-dx.local.json` in `ci.js` — none. `findSharedSecrets` is documented as scanning the shared file only.\n\n**Evidence.** `packages/core/ci.js` (`checkConfigSecrets`, `isGitTracked`), `packages/core/config.js:292-313` (`findSharedSecrets`).\n\n**Reachability.** Requires the user to defeat the gitignore, so niche; but the consequence is a committed key, and the step exists precisely to catch that class.\n\n**Solution options.**\n1. *(Recommended)* In `checkConfigSecrets`, call `isGitTracked(\".n-dx.local.json\", dir)` and fail the step when true, independent of contents (a tracked local file is wrong even when empty). Message: untrack with `git rm --cached .n-dx.local.json`, restore the ignore line, rotate any key it contained. Cost: a few lines and one e2e case.\n2. Also scan `.n-dx.local.json` for keys and warn (not fail) when it is untracked — unnecessary; that is the file keys are supposed to be in."
lastModified: "2026-09-14T19:01:19.388Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
