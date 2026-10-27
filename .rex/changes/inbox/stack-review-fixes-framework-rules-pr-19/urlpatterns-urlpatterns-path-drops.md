---
id: "67355995-9c9a-4149-84aa-f383602ce59a"
type: "task"
title: "urlpatterns = [*urlpatterns, path(...)] drops every earlier Django pattern with no notice"
slug: "urlpatterns-urlpatterns-path-drops"
description: "Verdict: should-fix (medium). Found by the adversarial review of 57bef8f2c (keep earlier urlpatterns when reassigned through itself).\n\nScenario: urls.py has `urlpatterns = [path(\"a/\", views.a)]`, then `urlpatterns = [*urlpatterns, path(\"b/\", views.b)]`. The second value is a list holding a path() call, so patternLists returns that list, and itemsOf yields only its path() entries (the list_splat is no @django.item). The assignment is not augmented, and the new @django.self capture only matches `urlpatterns` as a `+` operand or an argument_list child, not inside a list_splat. Result: urlpatterns becomes [path b], and /a/ is lost. No notice fires, because entries is non-empty.\n\nEvidence: packages/lang-python/queries/django/django.scm (@django.self patterns); packages/lang-python/src/django.ts extendsItself excludes any self inside a pattern list.\n\nReachable: sv/ndx analyze on any Django repo using the unpacking form (common in modern code). Not in django or netbox per the corpus.\n\nOptions:\n1. (Recommended) Add `(list (list_splat (identifier) @django.self) (#eq? @django.self \"urlpatterns\"))` and treat a splat self in the list as extending. Insert earlier entries at the splat's position, so `[path(x), *urlpatterns]` keeps order. Cost: one query pattern plus a position-aware merge in readUrlConf.\n2. Treat a splat self as append-at-end. Simpler, but the route order is wrong for a leading new entry. Routes are sorted by position anyway, so the impact is low."
acceptanceCriteria:
  - "`urlpatterns = [*urlpatterns, path(\"b/\", v.b)]` after `urlpatterns = [path(\"a/\", v.a)]` yields routes /a/ and /b/ (integration test in python-frameworks.test.ts)"
  - "`urlpatterns = [path(\"b/\", v.b), *urlpatterns]` keeps /a/ as well"
  - "The cost test asserts a splat @django.self is captured only for the name `urlpatterns` inside a list"
  - "Django golden unchanged"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "lang-python"
  - "django"
  - "pr-19"
source: "ndx-adversarial-review"
---
