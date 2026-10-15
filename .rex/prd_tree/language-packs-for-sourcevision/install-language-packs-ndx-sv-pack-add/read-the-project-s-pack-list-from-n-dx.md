---
id: "10c102ff-33f7-4c28-bc9f-fa2d07732d92"
level: "task"
title: "Read the project's pack list from .n-dx.json and isolate NDX_HOME in tests that run sourcevision"
status: "pending"
priority: "high"
tags:
  - "language-packs"
  - "sourcevision"
  - "config"
  - "pr-12b"
blockedBy:
  - "ac7a26e1-0f28-4e63-b481-4fa0fbf094e0"
source: "roadmap"
acceptanceCriteria:
  - "With `\"sourcevision\": { \"packs\": [\"java\"] }` and no Java pack, `sv analyze` prints one notice naming `ndx sv pack add java`; an unknown id prints one warning (tests)"
  - "`sv pack add` with no language installs the listed packs (injected npm runner) and reports an empty list"
  - "With no pack list, sv analyze output on the existing fixtures is byte-identical (goldens unedited)"
  - "Root and web suites set NDX_HOME to a temp directory before any test runs sourcevision; a test asserts it"
  - "The root policy suites pass, including vitest-hidden-spawn-policy and agents-md-size-budget"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
description: "Two pieces.\n\n1. The project pack list: `sourcevision.packs` in the project config (read through the layout resolver, like `loadInventoryConfig` in packages/sourcevision/src/language/detect.ts, so `.ndx/config.json` projects work too), an array of pack ids.\n- analyze: a listed pack that is missing or refused gives one notice naming `ndx sv pack add <lang>`, whether or not the project has files of that language yet; an unknown id gives one warning listing the known ids. A listed pack never changes what is analysed beyond what the loader does today: with no list (the default), output is byte-identical.\n- `sv pack add` with no language installs every listed pack that is not installed (each as `pack add <lang>` would), and says so when the list is empty or absent.\n- `sv pack list` marks listed packs.\n- Do not add `ndx config` support (core is out of scope); the key is set by editing the config file. Document the key in packages/sourcevision/AGENTS.md and the sourcevision docs, not the root guidance.\n\n2. Test isolation (review finding of run ea9bc901, dropped as low, now reachable because 12b installs into the real pack dir): sourcevision's own suite already points NDX_HOME at a temp dir (packages/sourcevision/tests/setup-ndx-home.ts). Do the same for the root suite and web's suite wherever they run sourcevision's analysis (a shared setup file, wired into vitest.config.js and packages/web/vitest.config.ts), so a developer's real `~/.ndx/packs` never shadows workspace packs. Keep main's hidden-spawn alias and existing setup files intact. web's vitest config is test setup, not web source.\n\nNo package.json dependency changes. Do not touch rex, hench, core or web source."
lastModified: "2026-10-15T04:27:00.658Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
