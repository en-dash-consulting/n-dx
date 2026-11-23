---
id: "c105a2c0-92f5-4e2f-ad3f-9e6a913d75d3"
type: "change"
title: "PHP estate quality fixes from the first real deep run"
slug: "php-estate-quality-fixes-from-the"
summary: "Fix what the first real scan of a legacy PHP repository got wrong: copied-in third-party libraries swamping the system map, valid old PHP reported as broken, duplicated folders counted twice, PHP routes missing from the output, and unexplained connection targets. This makes the map trustworthy for a migration."
intent: "PR 13 of the PHP language-pack stack, stacked on PR 12 (#1083, head 112898b7f). It comes from QA of the first real `ndx analyze --deep --full` run at 112898b7f on one legacy single-tenant PHP repository. The run covered about 4,000 files (about 1,600 PHP and 2,350 JS), with copied-in third-party libraries and a mirrored subtree. Captured 2026-11-17. **Don't run before Ryan says so:** overnight client scans hold the CPU and the Claude usage window until morning.\n\nPrivacy rule: no client name, repo name, path or finding text in this repository. Fixtures are invented, built to the shapes below.\n\nOrder:\n1. Third-party library exclusion. This is the biggest lever: it fixes zoning, entry points, classification, escalation cost, the primary language, readiness evidence and call-graph size together.\n2. Relabel legacy syntax and recover its facts.\n3. PHP routes into components.json.\n4. Mirrored subtrees.\n5. Outbound targets through constants and config.\n6. Telemetry and messages.\n\nLane rules: every code change goes through `ndx work`. Targeted tests on small invented fixtures. Byte-identical output for repositories without PHP, unless a task says otherwise (task 1's exclusion changes output for repositories that contain copied-in libraries, by design). Patch changesets at the fixed-group version. Run the six static root policy tests. Push and use gh only as ryrykeith."
acceptanceCriteria:
  - "Copied-in third-party libraries can be excluded or marked third-party, and are kept out of zones, entry points, classification, the escalation pass, primary-language detection, readiness evidence and the call graph"
  - "Valid legacy PHP that the grammar cannot parse is reported as legacy syntax by construct, not as syntax errors, and its import and call facts are recovered"
  - "PHP docroot and .htaccess routes appear in components.json"
  - "Each task is verified on an invented fixture with targeted tests"
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "high"
tags:
  - "php"
  - "lang-php"
  - "sourcevision"
  - "php-pr13"
  - "estate-qa"
blockedBy:
  - "01376afa-1f03-4da1-b42e-2baef55d2c9b"
---
