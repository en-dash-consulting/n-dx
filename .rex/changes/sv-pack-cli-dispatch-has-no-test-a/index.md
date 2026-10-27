---
id: "f45c9120-cf2b-4db9-b9d1-baab3a2e2302"
type: "change"
title: "`sv pack` CLI dispatch has no test: a broken `pack` case in cli/index.ts would pass every suite"
slug: "sv-pack-cli-dispatch-has-no-test-a"
intent: "Verdict: should-fix (low), from the adversarial review of task 224898e7.\n\nScenario: packages/sourcevision/src/cli/index.ts dispatches `case \"pack\": await cmdPack(args.slice(1))`. If that case is deleted, or passes `targetArg`/the wrong slice, `node dist/cli/index.js pack add java --dry-run` prints the wrong thing or fails \"Unknown command\". No test catches it. tests/unit/cli/pack.test.ts calls cmdPack directly, and tests/e2e/cli-arg-contracts.test.js only checks that `--help` lists `pack`. The acceptance criterion \"`node packages/sourcevision/dist/cli/index.js pack add java --dry-run` prints an npm install --prefix … command\" was verified by hand only.\n\nReachable: yes, through `ndx sv pack …` and `sv pack …`.\n\nOptions:\n(a) Recommended. Add a sourcevision e2e test that spawns the built CLI with NDX_HOME set to a temp dir. It asserts `pack add java --dry-run` stdout equals `npm install --prefix <NDX_HOME>/packs/<version> @n-dx/lang-java@<version>`, and that `pack add cobol` exits non-zero naming the known packs. Cost: one test file, about 1 s. It needs no network, because --dry-run spawns no npm.\n(b) Fold the test into the sibling offline-bundle task, which adds `--from` to the same dispatch. Cheaper, but it couples the two."
acceptanceCriteria:
  - "An e2e test spawns packages/sourcevision/dist/cli/index.js `pack add java --dry-run` with a temp NDX_HOME and asserts the exact `npm install --prefix <NDX_HOME>/packs/<version> @n-dx/lang-java@<version>` line"
  - "The same test asserts `pack add cobol` exits non-zero and names java, go, sql, terraform"
  - "Removing the `pack` case from src/cli/index.ts makes the test fail"
touches:
  - "6119e976-db18-4bb7-a1e1-ae6e40b7d197"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "language-packs"
  - "sourcevision"
  - "pr-12b"
source: "ndx-adversarial-review"
---
