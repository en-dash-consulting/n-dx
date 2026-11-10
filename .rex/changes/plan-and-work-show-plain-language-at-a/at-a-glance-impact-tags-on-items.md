---
id: "66179d54-2bb9-43c9-8ac0-5540edbcba50"
type: "task"
title: "At-a-glance impact tags on items"
slug: "at-a-glance-impact-tags-on-items"
description: "Items don't show whether they touch essential parts of the project, security-sensitive files (secrets, keys, rotations), or how large they are. Show small, visible tags with that basic information on items."
acceptanceCriteria:
  - "Each item shows small tags for: expected impact size (small / medium / large, with the number of files), a security flag when it touches secrets, keys, credentials, auth or rotation, an essential flag when it touches core or shared parts of the project, and the kinds of files involved (code, config, docs, tests)"
  - "Before work starts, the tags show the expected impact; after a run, they show what actually changed, taken from the run's diff"
  - "Each tag has a tooltip or link to the files behind it, for readers who want the detail"
priority: "medium"
source: "ndx-capture"
---
