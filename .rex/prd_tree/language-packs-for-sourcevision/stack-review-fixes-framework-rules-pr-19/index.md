---
id: "64050aaf-66fa-411c-90cb-7e89b93c0654"
level: "feature"
title: "Stack review fixes: framework rules (PR 19)"
status: "completed"
priority: "high"
tags:
  - "language-packs"
  - "review-fixes"
  - "frameworks"
  - "pr-19"
blockedBy:
  - "8a558da2-8724-4e8c-8a44-42b0d70b7f5b"
source: "review"
startedAt: "2026-10-17T09:07:43.064Z"
completedAt: "2026-10-17T09:07:43.064Z"
endedAt: "2026-10-17T09:07:43.064Z"
resolutionType: "code-change"
resolutionDetail: "PR 19: prototype-free framework rule tables (Spring and Python) with an outbound row guard; framework, project-facts, project-notices and symbol-refine failures contained as notices; Django urlpatterns reassignment and splat forms keep earlier patterns. Verified byte-identical against PR 18 on the whole corpus."
acceptanceCriteria:
  - "No framework rule table is read through the object prototype; outbound.json rows always satisfy the schema"
  - "A throw in one framework's rules no longer degrades the language's imports"
  - "Django urlpatterns reassignment keeps earlier patterns"
description: "Code fixes from the 2026-10-16 stack review to the framework rules (Spring Boot, Django) and the framework slot's failure handling. Stacked on #823 (PR 18). Brief: workshop language-scaling/pr17-20-review-fixes-brief.md."
lastModified: "2026-10-17T09:19:00.114Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [A throwing project facts reader, project notices or symbol refine still costs the whole language its imports](./a-throwing-project-facts-reader.md) | completed |
| [Contain a framework rule failure so the language's imports survive](./contain-a-framework-rule-failure-so.md) | completed |
| [Keep earlier Django URL patterns when urlpatterns is reassigned through itself](./keep-earlier-django-url-patterns-when.md) | completed |
| [Never read Spring rule tables through the object prototype](./never-read-spring-rule-tables-through.md) | completed |
| [urlpatterns = [*urlpatterns, path(...)] drops every earlier Django pattern with no notice](./urlpatterns-urlpatterns-path-drops.md) | completed |
