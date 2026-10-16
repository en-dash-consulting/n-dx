---
id: "30fc7750-2ae8-4b7f-a080-27ac14949bb3"
level: "feature"
title: "Python routes and outbound calls through the Python pack (PR 16)"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "lang-python"
  - "frameworks"
  - "outbound"
  - "sourcevision"
  - "side-stack"
  - "pr-16"
blockedBy:
  - "502ac1a1-b7b6-42e7-9c9b-38fc974fdd3d"
source: "roadmap"
acceptanceCriteria:
  - "The Python pack produces routes for FastAPI, Flask and Django, mounted prefixes followed across files, and outbound calls for the listed clients with confidence"
  - "A Python repo analysed with the pack gets its routes in components.json serverRoutes and its outbound calls in outbound.json"
  - "Every repo without Python, and Python repos without the pack, analyse byte-identically to PR 15b"
  - "Counts, notices and hand-checked samples per corpus repo are logged"
description: "Give Python what PR 14 gave Spring Boot: framework packs in @n-dx/lang-python that produce `routes` (FastAPI, Flask, Django) and `outboundCalls` (requests, httpx, aiohttp, urllib, grpc, Kafka, pika, Celery, os.environ) facts. PR 14's language-neutral wiring persists them into components.json `serverRoutes` and outbound.json with Hal's role filters, so no new sourcevision wiring is expected. Cross-file mounting (include_router, register_blueprint, Django include) follows imports through the pack's resolver, which `FrameworkPack.read` gains as an optional context. Brief: workshop language-scaling/pr16-python-frameworks-brief.md."
lastModified: "2026-10-16T00:03:33.142Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [DRF router.register calls on a router imported from another file are not counted in the Django notice](./drf-router-register-calls-on-a-router.md) | pending |
| [Pin CTFd and Netflix/dispatch, run python-routes-report and the PR 16 byte-identity checks](./pin-ctfd-and-netflix-dispatch-run.md) | completed |
| [Python outbound calls: http, grpc, queue and env clients](./python-outbound-calls-http-grpc-queue.md) | pending |
| [Python web routes: FastAPI, Flask and Django framework packs](./python-web-routes-fastapi-flask-and.md) | completed |
| [The Django query captures every list and tuple, adding seconds to large Python data files in every analyze](./the-django-query-captures-every-list.md) | pending |
