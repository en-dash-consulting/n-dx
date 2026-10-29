---
id: "e9435b47-1ab2-4739-9338-ab00f1c518d6"
type: "task"
title: "Discover extensions across sources with a cache"
slug: "discover-extensions-across-sources"
acceptanceCriteria:
  - "Finds manifests in project, user (`<ndx home>/extensions`), global and dev-path sources, in that precedence"
  - "Reads only `package.json`; a test proves no package code runs during discovery"
  - "Same package in two sources: the higher wins and `info` names the other; two packages with one name are both refused"
  - "Result cached in `<ndx home>/extensions.json` and recomputed when a source folder changes; `ndx --help` with 20 installed extensions adds under 50 ms over none"
  - "`$NDX_HOME` and the legacy `~/.n-dx` home are honoured"
priority: "critical"
tags:
  - "extensions"
source: "ndx-capture"
blockedBy:
  - "03ef01ab-cea6-48f9-934b-c06c6fbf5673"
---
