---
id: "312ab8e2-ebdc-471b-8690-43ee7fcd033f"
type: "change"
title: "Fix structural in config-validation-gauntlet (1 finding)"
slug: "fix-structural-in-config-validation"
intent: "- The gauntlet/ directory sits outside the established e2e/ and integration/ test directory conventions, which may cause it to be excluded from standard test runs if glob patterns are not kept in sync."
touches:
  - "9679e55e-a3c0-43e3-b240-1e749613e9cc"
priority: "high"
source: "sourcevision"
---
