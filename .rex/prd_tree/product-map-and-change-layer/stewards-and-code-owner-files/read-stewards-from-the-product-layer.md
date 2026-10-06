---
id: "1e556ade-c4a9-443a-93e5-d87e5d409a45"
level: "task"
title: "Read stewards from the product layer and generate code-owner files per host"
status: "pending"
priority: "medium"
tags:
  - "pr-25"
  - "lane-core-docs"
  - "rex"
  - "core"
source: "roadmap"
acceptanceCriteria:
  - "Both files are generated from one stewards list (tests)"
  - "Touches-only changes match no code-owner rule"
  - "Generation is opt-in"
description: "stewards: on the root product/index.md with optional per-area override; entries are git emails with optional GitHub or Bitbucket handle and group aliases. Opt-in generation of CODEOWNERS (GitHub) and .bitbucket/CODEOWNERS (Bitbucket) mapping each area folder to its stewards, regenerated when the lists change."
lastModified: "2026-10-06T16:54:38.105Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
