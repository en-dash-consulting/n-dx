---
id: "2d8ed30f-928b-48a9-8a13-5e0b20baf11a"
level: "task"
title: "A urlpatterns assignment inside a def or class replaces the module's Django urlpatterns"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "lang-python"
  - "django"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A module with `urlpatterns = [path(\"a/\", v.a)]` and a method assigning a local `urlpatterns = super().get_urls()` still yields /a/ and no 'drops the patterns' notice (integration test)"
  - "A urlpatterns assignment under a module-level `if settings.DEBUG:` still counts"
  - "Django golden and python routes corpus report unchanged"
description: "Verdict: out-of-scope (low). This predates 57bef8f2c, which made it visible: since that commit it can also raise a misleading notice.\n\nScenario: a module with `urlpatterns = [path(\"a/\", v.a)]` and a method `def get_urls(self): urlpatterns = super().get_urls(); return urlpatterns` (the ModelAdmin/AdminSite idiom). django.scm's `(assignment left: (identifier) @django.target ...)` captures assignments at any depth. readUrlConf therefore treats the local assignment as a reassignment of the module's urlpatterns. Today it replaces the module's patterns with [] (route /a/ lost). Since 57bef8f2c it also emits \"Django: 1 urlpatterns assignment drops the patterns set before it...\" for code that drops nothing. Conversely, a function-local `urlpatterns = [...]` becomes the module's URLconf.\n\nEvidence: packages/lang-python/queries/django/django.scm (urlpatterns assignment patterns); packages/lang-python/src/django.ts readUrlConf.\n\nReachable: analyze on a Django project whose URLconf module also defines a function with a local `urlpatterns`. The django and netbox corpus routes and notices were unchanged by 57bef8f2c, so it is rare.\n\nOptions:\n1. (Recommended) Keep only module-level urlpatterns assignments. Either anchor the query to `(module (expression_statement (assignment ...)))` while still allowing module-level if/try blocks, or filter in readUrlConf by checking the assignment is not inside a function or class definition capture (python definitions captures exist). Cost: small. Risk: a URLconf built under `if settings.DEBUG:` must still count.\n2. Leave as is. It is rare in practice."
lastModified: "2026-10-17T08:53:35.743Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
