---
id: "e32505e5-1952-4344-a431-75b060758a73"
level: "epic"
title: "ndx 0.8.0 · Find your way"
status: "pending"
priority: "high"
tags:
  - "0.8.0"
  - "release-epic"
source: "caos work management: epic ndx 0.8.0 · Find your way; 0.8.0 planning (2026-09-25)"
acceptanceCriteria:
  - "ndx start on a project that has never been analysed lands on Home showing a preflight card, never on an empty tool view."
  - "Every pre-0.8.0 dashboard path redirects to its new page; the navigation contract test lists every view and each deep-links with zero console errors."
  - "The sidebar shows 7 groups and 24 items with no accordion; Terrain and Architecture are tabbed pages."
  - "Interactive analyze, plan and recommend print a preflight banner and pause unless --yes is passed; autonomous modes never pause; --format=json output is unchanged."
  - "The three settings pages read provider and model from both the old and the new config locations."
  - "A pre-0.8.0 project upgrades with no edit to any config key, PRD file or run record."
description: "Minor release that gives a first-time user a place to land and a way to know what each command will do. Today ndx start opens on an empty analysis page, the sidebar lists 33 items in six one-at-a-time sections, settings are spread across six routes, and nothing says whether a command is read-only, why it calls an LLM or what it costs. This release adds a state-aware Home page, landing pages for SourceVision, Rex and Hench, a 24-item always-open sidebar with tabbed Terrain and Architecture pages, three settings pages (Robot Wrangler for provider and model, Workflow, Project), and a command effects manifest that drives a preflight banner in the terminal and preflight cards, Run buttons and one shared job tray in the dashboard. Robot Wrangler also takes on the vendor-aware hench model and provider settings deferred from 0.7.1. Alongside the UI it carries the additive halves of the PRD-storage and folder-layout changes, a rex log command and budget tuners that measure cost in the same units as the token budget, deterministic replacements for the remaining wall-clock test assertions, and a tested contract for Codex session reuse. The cache and prune configuration keys first planned here shipped early, in 0.7.1. Every renamed route keeps a redirect and every schema change is additive.\n\nGoal: Someone opening n-dx for the first time knows where they are, what to do next, and what each action will read, write and spend before they run it."
lastModified: "2026-09-29T17:28:30.942Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Codex cache safety](./codex-cache-safety/index.md) | pending |
| [Command transparency](./command-transparency/index.md) | pending |
| [Layout resolver](./layout-resolver/index.md) | pending |
| [Navigation and landings](./navigation-and-landings/index.md) | pending |
| [PRD storage additive](./prd-storage-additive/index.md) | pending |
| [Release readiness](./release-readiness/index.md) | pending |
| [rex log and budget tuners](./rex-log-and-budget-tuners/index.md) | pending |
| [Settings consolidation](./settings-consolidation/index.md) | pending |
| [Test determinism](./test-determinism/index.md) | completed |
| [Vendor-aware hench model and provider settings](./vendor-aware-hench-model-and-provider/index.md) | pending |
