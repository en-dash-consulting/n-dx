---
id: "143e479a-714f-44dd-8047-636012e9ee5b"
type: "task"
title: "extensions.json gains a project scan entry for every working directory ever used and is never pruned"
slug: "extensions-json-gains-a-project-scan"
description: "Verdict: should-fix. extension-discovery.js:176,181 keys project scans by project:<cwd> and copies all cached entries forward, so every ndx --help or unknown command from a new directory adds an entry and forces a write; the file grows without bound and every run parses it. Fix: keep only the current scans' keys plus a small LRU (about 20) of project entries."
acceptanceCriteria:
  - "After discovery runs from 50 different directories, extensions.json holds a bounded number of project entries"
priority: "low"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
