---
id: "30fc7750-2ae8-4b7f-a080-27ac14949bb3"
type: "change"
title: "Python routes and outbound calls through the Python pack (PR 16)"
slug: "python-routes-and-outbound-calls"
intent: "Give Python what PR 14 gave Spring Boot: framework packs in @n-dx/lang-python that produce `routes` (FastAPI, Flask, Django) and `outboundCalls` (requests, httpx, aiohttp, urllib, grpc, Kafka, pika, Celery, os.environ) facts. PR 14's language-neutral wiring persists them into components.json `serverRoutes` and outbound.json with Hal's role filters, so no new sourcevision wiring is expected. Cross-file mounting (include_router, register_blueprint, Django include) follows imports through the pack's resolver, which `FrameworkPack.read` gains as an optional context. Brief: workshop language-scaling/pr16-python-frameworks-brief.md."
acceptanceCriteria:
  - "The Python pack produces routes for FastAPI, Flask and Django, mounted prefixes followed across files, and outbound calls for the listed clients with confidence"
  - "A Python repo analysed with the pack gets its routes in components.json serverRoutes and its outbound calls in outbound.json"
  - "Every repo without Python, and Python repos without the pack, analyse byte-identically to PR 15b"
  - "Counts, notices and hand-checked samples per corpus repo are logged"
priority: "medium"
tags:
  - "language-packs"
  - "lang-python"
  - "frameworks"
  - "outbound"
  - "sourcevision"
  - "side-stack"
  - "pr-16"
source: "roadmap"
blockedBy:
  - "502ac1a1-b7b6-42e7-9c9b-38fc974fdd3d"
---
