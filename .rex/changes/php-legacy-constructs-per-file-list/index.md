---
id: "901e0556-9673-4eb8-bd46-1cd4789422ab"
type: "change"
title: "PHP legacy constructs per file: list each file's removed and deprecated uses for upgrade planning"
slug: "php-legacy-constructs-per-file-list"
summary: "Today an analysis says how many old PHP features a repository uses, but not which files use them. Listing them per file lets an upgrade (for example a PHP 8 step with Rector) be planned and split file by file."
intent: "PR 14, stacked on PR 13b (feat/sv-php-pr13-deep-run-followups). Asked for by the PHP consolidation engagement: its security priority is the PHP 5 single-tenant apps, and the pilot's PHP 8 step plans Rector by file. sdlc-profile.json's `ecosystem.<language>.legacyConstructs` and `versionFloors` already give per-repository counts (every active repo of the 66 has constructs removed in 7.0); the per-file facts exist in the pack (`LegacyConstructFact`, `VersionFloorFact`, each with a position) but no artifact lists them by file.\n\nThe change adds one artifact listing, per language and per file, the file's version floor and each legacy-construct use (rule, construct, status, the deprecated/removed version, line). Third-party files are listed apart, mirror copies dropped, matching how `pack-ecosystem.ts` counts. Facts only, no code text; no new pack facts and no new rules."
acceptanceCriteria:
  - "A deep or fast analysis of a repository with legacy-construct or version-floor facts writes a per-file list whose totals equal sdlc-profile.json's legacyConstructs and versionFloors for the same run"
  - "A repository without such facts writes the analysis it always did, and a stale list from an earlier run is removed"
  - "Unit and integration tests on invented PHP fixtures; docs and a patch changeset"
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "high"
tags:
  - "sourcevision"
  - "lang-php"
  - "php-pr14"
---
