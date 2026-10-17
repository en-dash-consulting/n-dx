---
id: "64050aaf-66fa-411c-90cb-7e89b93c0654"
level: "feature"
title: "Stack review fixes: framework rules (PR 19)"
status: "pending"
priority: "high"
tags:
  - "language-packs"
  - "review-fixes"
  - "frameworks"
  - "pr-19"
blockedBy:
  - "8a558da2-8724-4e8c-8a44-42b0d70b7f5b"
source: "review"
acceptanceCriteria:
  - "No framework rule table is read through the object prototype; outbound.json rows always satisfy the schema"
  - "A throw in one framework's rules no longer degrades the language's imports"
  - "Django urlpatterns reassignment keeps earlier patterns"
description: "Code fixes from the 2026-10-16 stack review to the framework rules (Spring Boot, Django) and the framework slot's failure handling. Stacked on #823 (PR 18). Brief: workshop language-scaling/pr17-20-review-fixes-brief.md."
lastModified: "2026-10-17T08:26:35.984Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Contain a framework rule failure so the language's imports survive](./contain-a-framework-rule-failure-so.md) | completed |
| [Keep earlier Django URL patterns when urlpatterns is reassigned through itself](./keep-earlier-django-url-patterns-when.md) | completed |
| [Never read Spring rule tables through the object prototype](./never-read-spring-rule-tables-through.md) | completed |
| [urlpatterns = [*urlpatterns, path(...)] drops every earlier Django pattern with no notice](./urlpatterns-urlpatterns-path-drops.md) | pending |
