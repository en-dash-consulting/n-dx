---
id: "5da69852-d9e7-4026-b5e5-ec644f1b1cb6"
type: "task"
title: "Read composer.lock files up to a larger cap than other build files"
slug: "read-composer-lock-files-up-to-a"
summary: "Big PHP projects have Composer lock files larger than the size limit n-dx uses for build files, so n-dx cannot tell which outside package a namespace comes from. A separate, larger limit for lock files keeps those package names."
description: "In-scope fix for review finding 566f8f43 (run 55fbcac8 of task a34d8b17); read that change's intent for the scenario and the evidence. readComposerProjects in packages/lang-kit/src/php-composer.ts reads composer.lock through readBuildFile, whose 1 MiB cap (MAX_BUILD_FILE_BYTES) drops lockPackages on large projects. Take option 1 from the finding: a separate, larger cap for composer.lock only (16 MiB), passed to the reader without changing the cap for any other build file. Above the new cap, keep the notice and no lockPackages, never a throw. Add a patch changeset for @n-dx/lang-kit, or extend the one task a34d8b17 added.\n\n**Operator note, 2026-11-14:** corpus lock sizes measured by the operator: koel 605 KB, symfony-demo 436 KB, phpbb 61 KB, mediawiki (test fixture) 40 KB. None reach 1 MiB, so the tests must build an oversized lock in a temp directory rather than commit one. Run `npx vitest run` inside packages/lang-kit. Never commit anything under any package's build/."
acceptanceCriteria:
  - "A composer.lock between 1 MiB and the new lock cap yields lockPackages, with a unit test that fails against the 1 MiB cap"
  - "A composer.lock above the new cap still yields a notice and no lockPackages, never a throw"
  - "Every other build file keeps the 1 MiB cap"
priority: "high"
run: {"tier":"standard","review":true,"reviewTier":"standard","skipTestGate":true,"maxTurns":80}
source: "ndx-adversarial-review"
---
