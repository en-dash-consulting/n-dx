---
id: "fc7cb80d-1cb7-4074-bbad-165858721bb5"
type: "task"
title: "Architecture contract, help text and a changeset describe the pre-fix config file, approval binding and signals"
slug: "architecture-contract-help-text-and-a"
description: "Verdict: should-fix (doc drift). docs/architecture/extensions.md:140,193,251 say NDX_EXTENSION_CONFIG holds the merged section for every process (sidecars now get the user section only); :187,245 say an approval binds hash plus version (now also source and real path); :230 says SIGINT and SIGTERM are forwarded (POSIX now runs non-detached and forwards SIGHUP). packages/core/help.js:1805 says 'tied to that version and manifest'; .changeset/extension-dispatch.md:5 repeats the old signal list. Fix: update those lines to match the code and docs/extensions/."
acceptanceCriteria:
  - "docs/architecture/extensions.md, help.js and the changesets match the shipped config-file, approval-binding and signal behaviour"
priority: "low"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
