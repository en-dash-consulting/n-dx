---
id: "224898e7-8081-4e71-86c4-b922cd1b371a"
level: "task"
title: "Add `sv pack add`, `pack list` and `pack remove` over the per-user pack directory"
status: "completed"
priority: "high"
tags:
  - "language-packs"
  - "sourcevision"
  - "cli"
  - "pr-12b"
source: "roadmap"
startedAt: "2026-10-15T04:28:45.782Z"
completedAt: "2026-10-15T04:40:15.667Z"
endedAt: "2026-10-15T04:40:15.667Z"
resolutionType: "code-change"
resolutionDetail: "sv pack add/list/remove in src/cli/commands/pack.ts; notices name `ndx sv pack add <lang>`; tests with fake npm."
acceptanceCriteria:
  - "Tests with an injected npm runner cover add (success, unknown id, npm failure, version mismatch after install), list (pack dir, resolution, missing, refused) and remove"
  - "`node packages/sourcevision/dist/cli/index.js pack add java --dry-run` prints an `npm install --prefix <ndx home>/packs/<version> @n-dx/lang-java@<version>` command"
  - "The missing-pack notice names `ndx sv pack add <lang>` (tests updated)"
  - "shell-spawn-inventory-policy passes with the new npm spawn registered"
  - "Analysis output is unchanged: sourcevision and lang-* suites pass with goldens unedited"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
description: "A `pack` command in sourcevision's CLI (packages/sourcevision/src/cli/index.ts dispatch, a new src/cli/commands/pack.ts), reached as `ndx sv pack …` with no core change.\n\n- `sv pack add <lang>`: installs `@n-dx/lang-<lang>@<sourcevision version>` into `defaultPackDir()` with `npm install --prefix <dir>` (create the directory if missing). Unknown ids (anything but java, go, sql, terraform) are refused with the list of known ones. After installing, load the pack through pack-loader.ts and report what was installed; a version mismatch or a pack that fails to load is an error with the npm output, never a silent success. `--dry-run` prints the command without running it.\n- `sv pack list`: one line per known pack: installed in the pack dir, found by resolution (for example the default Go pack, an optional dependency), missing, or refused (version mismatch), with its version. `--json` for machine output.\n- `sv pack remove <lang>`: `npm uninstall --prefix <dir> @n-dx/lang-<lang>`; removing a pack that is only found by resolution says so and does nothing.\n- The missing-pack and version-mismatch notices (packInstallCommand and its callers) name `ndx sv pack add <lang>` instead of the raw npm command. Update the tests that pin the notice text.\n- npm runs through @n-dx/llm-client's spawn helpers (spawnCli / execStdout or the helper the shell-spawn inventory expects), with `npm` resolved the way other sourcevision spawns resolve executables on Windows; register the spawn in the inventory. Make the runner and the pack dir injectable; tests use a fake npm and a temp ndx home, never the network.\n- `sv --help` and `sv pack --help` describe the commands; packages/sourcevision/AGENTS.md says how packs are installed (not the root guidance: the root AGENTS.md chain has ~119 bytes left).\n\nOut of scope: offline bundles and the project pack list (next tasks). No package.json dependency changes. Do not touch rex, hench, core or web source."
lastModified: "2026-10-15T04:40:15.965Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
