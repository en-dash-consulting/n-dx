---
id: "2ef5ac26-db3e-468b-90d2-5059882fad08"
level: "task"
title: "Keep earlier Django URL patterns when urlpatterns is reassigned through itself"
status: "in_progress"
priority: "high"
tags:
  - "review-fixes"
  - "lang-python"
  - "django"
  - "pr-19"
source: "review"
startedAt: "2026-10-17T08:48:26.306Z"
acceptanceCriteria:
  - "urlpatterns = format_suffix_patterns(urlpatterns) and urlpatterns = urlpatterns + … keep the earlier patterns (and append new list entries)"
  - "A reassignment to a fresh list still replaces; a shrink to nothing emits a notice"
  - "Fixtures cover each form; django.scm cost bound kept"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"Builds on PR 16's narrowed django.scm (bfc8e82b): keep its capture rules unless a form here needs a capture it lacks, and keep the query's cost bound. The hench sandbox may block ~/.cache corpora; leave corpus checks to the session and do not capture follow-ups for them."}
description: "Stack review (#796, django.ts around line 115). Reassigning urlpatterns to anything other than a list literal silently discards every earlier pattern. This is the DRF tutorial idiom:\n\n```python\nurlpatterns = [path(\"snippets/\", views.snippet_list), path(\"snippets/<int:pk>/\", views.snippet_detail)]\nurlpatterns = format_suffix_patterns(urlpatterns)\n```\n\nThe second statement is captured as a urlpatterns assignment. patternLists returns [], because the value is a call and lists inside calls are excluded. The assignment isn't augmented, so urlpatterns becomes [], and the file yields zero routes with no notice, whether it is the ROOT_URLCONF or an included module. Related cases:\n- `urlpatterns = urlpatterns + static(...)` drops everything;\n- `urlpatterns = urlpatterns + [path(...)]` keeps only the new list.\n\nFix: when the value refers to urlpatterns itself (an identifier operand of `+`, or an argument of the wrapping call), keep the existing entries and append any new ones. At minimum, emit a notice when an assignment would shrink a non-empty urlpatterns to nothing. Fixtures: format_suffix_patterns, `urlpatterns + static(...)`, `urlpatterns + [path(...)]`, and a genuine reassignment to a new list, which replaces as today. Expected corpus change: Django repos using these forms gain their routes back. The session checks django and netbox and hand-checks changed routes."
lastModified: "2026-10-17T08:48:26.625Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
