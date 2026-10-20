---
id: "965c4f42-cbc3-431f-ae1a-af083d6ad130"
level: "task"
title: "DRF router.register calls on a router imported from another file are not counted in the Django notice"
status: "completed"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "lang-python"
  - "frameworks"
source: "ndx-adversarial-review"
startedAt: "2026-10-16T03:25:08.545Z"
completedAt: "2026-10-16T03:30:52.091Z"
endedAt: "2026-10-16T03:30:52.091Z"
resolutionType: "code-change"
resolutionDetail: "14c9e4d93: router names are resolved across files with WebProject.defined, for both register() and include(router.urls); a fixture and the golden are updated."
acceptanceCriteria:
  - "A Django fixture with the router defined in one module and registered from another counts that registration in the DRF notice"
  - "include(router.urls) with the router imported from another module is left out silently, as for a local router, and not listed among the include() targets not followed"
  - "The django routes golden changes only by the new fixture files' entries"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"Take option 1, building on bfc8e82b's narrowed django.scm, which is already committed on this branch. Only notices change: routes, every artifact and the existing golden entries stay byte-identical (the session verifies this on the corpus). Also follow a router imported under an alias (`from .routers import router as api_router`) and one reached through a module attribute (`from . import routers` then `routers.router.register(...)`), if WebProject.defined already supports those forms; if not, say so in the log rather than widening the lookup. Ship as one commit on feat/sv-lang-pr16-python-frameworks with a changeset. The hench sandbox may block the network and ~/.cache/ndx-python-corpus. If it does, leave the corpus run and the byte-identity checks to the session, which verifies them; do not capture follow-ups for them."}
description: "Verdict: should-fix (low). Found by the adversarial review of e589b220 (PR 16 routes).\n\nScenario: api/routers.py has `router = DefaultRouter()`. api/views.py has `from .routers import router` and `router.register(\"sites\", SiteViewSet)`. urls.py has `path(\"api/\", include(router.urls))`. The register call in views.py is not counted, because conf.routers only holds names bound to a `...Router(...)` call in the same file. The include of router.urls in urls.py is also not recognised as a DRF router (no local binding), so it lands in the \"include() targets ... were not followed\" notice instead. The user is told nothing about the registrations that produced no routes.\n\nEvidence: packages/lang-python/src/django.ts. readUrlConf collects `routers` from the file's own assignments. The register count loop checks `conf.routers.has(call.receiver)`, and targetOf's `segments[1] === \"urls\" && conf.routers.has(segments[0])` does the same.\n\nReachable: `sv analyze` with the Python pack on a DRF project that defines its router in one module and registers in others. netbox defines and registers in the same api/urls.py, so the corpus may not show it.\n\nOptions:\n1. (Recommended) Resolve the receiver with WebProject.defined(file, receiver, (f, name) => confs.get(f)?.routers.has(name)) in both places, as the router frameworks already follow names. Cost: two call sites and a fixture file. Risk: none beyond the lookup cost.\n2. Count every `X.register(...)` whose X is any imported name. Over-counts admin.site.register, so it is not recommended."
lastModified: "2026-10-16T03:30:52.687Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
