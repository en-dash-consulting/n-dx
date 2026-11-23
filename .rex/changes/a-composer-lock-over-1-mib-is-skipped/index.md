---
id: "566f8f43-9337-4b2c-a821-2fd13b82e05d"
type: "change"
title: "A composer.lock over 1 MiB is skipped, so large Composer projects lose every package's autoload prefixes"
slug: "a-composer-lock-over-1-mib-is-skipped"
summary: "Large PHP projects have lock files over the build-file size limit, so n-dx cannot tell which outside package a namespace comes from. Raising the limit for lock files keeps package names on large projects."
intent: "Verdict: should-fix (medium), from the adversarial review of task a34d8b17.\n\nScenario: a Composer project whose composer.lock is larger than MAX_BUILD_FILE_BYTES (1 MiB). Lock entries carry descriptions, authors, support and funding blocks, so a few hundred packages approach or pass 1 MiB. readComposerProjects then reads the lock through readBuildFile, gets { oversized }, records a notice and leaves `lockPackages` absent. The PHP resolver (task 461493c0) then cannot fill D5's in-memory `module` field for any external of that project.\n\nEvidence: packages/lang-kit/src/php-composer.ts readComposerProjects → readBuildFile (packages/lang-kit/src/build-file.ts, 1 MiB cap), parseObject's oversized branch.\n\nReachability: analyze with the PHP pack on any large Composer application, once the resolver consumes lockPackages. It is not reachable today because nothing consumes the reader yet. Edges are unaffected; only module names are lost.\n\nOptions:\n1. (recommended) A separate, larger cap for composer.lock (e.g. 16 MiB). JSON.parse is linear, so the risk is memory only. Cheap.\n2. Stream-parse only `packages[].name` and `autoload`. More code for little gain.\n\nMeasure real lock sizes on the corpus (koel, mediawiki, phpbb, symfony-demo) before choosing the cap."
acceptanceCriteria:
  - "A composer.lock between 1 MiB and the new lock cap yields lockPackages, with a unit test that fails against the 1 MiB cap"
  - "A composer.lock above the new cap still yields a notice and no lockPackages, never a throw"
touches:
  - "5e5d32b1-26ae-4594-a229-4b579038d053"
priority: "medium"
discoveredFrom: {"item":"a34d8b17-2c8d-49d8-8c29-d5ac378cfd0c","run":"55fbcac8-eabf-46e7-b057-80e20b8da7e4"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "php"
  - "lang-kit"
  - "composer"
source: "ndx-adversarial-review"
---
