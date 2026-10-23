---
id: "75619751-480b-48cb-b543-7409f49387b0"
type: "change"
title: "Standardize self-heal tag to 'self-heal-items' across creation and selection paths"
slug: "standardize-self-heal-tag-to-self-heal"
intent: "Audit every code path that creates PRD items during a self-heal run (recommend, analyze, smart-add, ad-hoc add) and ensure each one stamps the 'self-heal-items' tag onto new epics, features, and tasks. Audit the hench task selector's self-heal-mode filter to require this exact tag. Reconcile any references to a legacy 'self-heal' tag — either migrate them to 'self-heal-items' or define both as equivalent in a single canonical constant — so creation and selection use the same source of truth."
acceptanceCriteria:
  - "A single exported constant defines the self-heal tag value and is imported by both the creation paths and the selector"
  - "Every PRD item created during a self-heal run carries the 'self-heal-items' tag in its persisted frontmatter"
  - "Hench task selection in self-heal mode returns only items whose tags include 'self-heal-items'; untagged or differently-tagged items are skipped with a logged reason"
  - "If a legacy 'self-heal' tag still exists on past items, the selector treats it as equivalent OR a one-time migration retags them — the chosen approach is documented in the commit message"
touches:
  - "3d6ce70a-5c04-49a7-a358-90490b7ffa41"
priority: "high"
tags:
  - "hench"
  - "self-heal"
  - "prd"
source: "smart-add"
---
