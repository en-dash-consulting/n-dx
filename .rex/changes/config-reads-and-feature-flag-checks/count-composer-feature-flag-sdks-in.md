---
id: "647ad9da-c922-487c-8c90-8c590b9752c0"
type: "task"
title: "Count Composer feature-flag SDKs in the feature-flags readiness dimension"
slug: "count-composer-feature-flag-sdks-in"
summary: "Make the feature-flags readiness check recognise PHP flag libraries, as it already does for JavaScript, Go and Python."
description: "In `packages/sourcevision/src/analyzers/sdlc-profile.ts`, beside `FEATURE_FLAG_DEPS` and `FEATURE_FLAG_PY_DISTS`, add a Composer table and read `composer.json` `require` (and `require-dev`) with lang-kit's Composer reader, so a PHP repository that depends on a flag SDK scores on the feature-flags dimension with evidence citing composer.json, the same way Python distributions do.\n\nUse exactly the package names in the operator note below (verified on packagist.org by the operator; do not add names from memory).\n\nTests: a composer.json with a flag SDK scores with evidence; one without does not; non-PHP fixtures unchanged.\n\n**Operator note:** Composer flag SDK package names, verified on packagist.org before the run: (filled in by the operator)."
acceptanceCriteria:
  - "A PHP repository depending on a listed Composer flag SDK scores on the feature-flags readiness dimension with composer.json evidence"
  - "Package names come only from the operator note"
  - "Readiness output for non-PHP fixtures is unchanged"
priority: "medium"
run: {"tier":"standard","review":true,"reviewTier":"standard","skipTestGate":true,"maxTurns":80}
tags:
  - "php"
  - "sourcevision"
  - "readiness"
blockedBy:
  - "a34d8b17-2c8d-49d8-8c29-d5ac378cfd0c"
---
