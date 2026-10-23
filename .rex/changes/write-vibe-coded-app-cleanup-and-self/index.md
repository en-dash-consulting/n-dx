---
id: "bdf200a2-5695-4716-9ede-73720c5e32c9"
type: "change"
title: "Write Vibe-Coded App Cleanup and Self-Healing Guide"
slug: "write-vibe-coded-app-cleanup-and-self"
intent: "Document how to use n-dx to systematically clean up a codebase that was built quickly without formal structure — ad-hoc code, missing tests, architectural violations, or accumulated tech debt. Covers running sourcevision to surface findings, using `ndx recommend` to generate actionable PRD proposals from those findings, accepting a remediation plan, and executing it autonomously with `ndx work` or `ndx self-heal`. Includes guidance on prioritizing findings and setting realistic scope."
acceptanceCriteria:
  - "Guide covers the full cleanup loop: `ndx analyze` → `ndx recommend` → proposal review → `ndx plan --accept` → `ndx work` or `ndx self-heal`"
  - "Guide explains how to read sourcevision findings and distinguish high-impact architectural issues from low-signal noise"
  - "Guide includes a section on scoping a cleanup sprint: how to accept a subset of proposals and defer the rest"
  - "Guide documents the `ndx self-heal` command and how it differs from a manual `ndx work` loop"
  - "A developer can follow the guide to go from a messy codebase to a structured remediation plan and begin executing it in one session"
touches:
  - "32799258-d738-428d-8d6f-8a5bfacfb12a"
priority: "high"
tags:
  - "docs"
  - "sourcevision"
  - "self-heal"
  - "cleanup"
source: "smart-add"
---
