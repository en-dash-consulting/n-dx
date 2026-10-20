---
id: "32e56fc0-dc0b-44bb-bd99-a8a3273cb631"
level: "task"
title: "Python outbound calls: http, grpc, queue and env clients"
status: "completed"
priority: "medium"
tags:
  - "language-packs"
  - "lang-python"
  - "outbound"
  - "pr-16"
blockedBy:
  - "e589b220-a46e-4cd2-89e6-3da637ca39fe"
source: "roadmap"
startedAt: "2026-10-16T00:48:46.868Z"
completedAt: "2026-10-16T01:17:05.737Z"
endedAt: "2026-10-16T01:17:05.737Z"
resolutionType: "code-change"
resolutionDetail: "python-clients framework pack (src/python-clients.ts + queries/python-clients) producing outboundCalls for requests, httpx, aiohttp, urllib, grpc, confluent_kafka, kafka-python, pika, Celery and os.environ, with goldens, the outbound report and docs. Byte-identity and home-assistant timing are not run yet; they need the operator's harness (see log)."
acceptanceCriteria:
  - "A python-clients framework pack produces outboundCalls for requests, httpx, aiohttp, urllib, grpc, confluent_kafka, kafka-python, pika, Celery send_task and os.environ, with provenance per rule"
  - "Targets follow the literal/env/config/unknown rules and confidence is certain or likely only as specified"
  - "Goldens cover every client and target rule including aliases, async with, Session, pika default exchange, settings-prefixed f-string, unknown target and a likely call"
  - "The outbound report logs per-repo counts by kind, client and confidence with a 15-call hand-checked sample"
  - "Byte-identical without Python or without the pack; with the pack only Python outbound dependencies are added; home-assistant timing logged; suites pass"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"The hench sandbox may block the network and ~/.cache/ndx-python-corpus. If it does, write python-outbound-report.mjs and the goldens, and leave the corpus run, the home-assistant timing and the byte-identity checks to the session that runs this task (it verifies them against a PR 16 task 1 baseline); do not capture a follow-up item for them. task e589b220's FrameworkContext is available for following settings or client objects across files."}
description: "Add `outboundCalls` facts to `@n-dx/lang-python` through a `python-clients` framework pack (lang-runtime `FrameworkPack`, provenance per rule, run only when `outboundCalls` is asked for), following Spring Boot's outbound rules in `packages/lang-java/src/spring-boot.ts`. Add `outboundCalls` to the Python pack's `produces`.\n\nClients (kind, client):\n- http: `requests` module functions (`get/post/put/patch/delete/head/options/request`) and `requests.Session()` methods; `httpx` module functions and `httpx.Client()`/`httpx.AsyncClient()` methods (including `async with httpx.AsyncClient() as c:`); `aiohttp.ClientSession()` methods (`get/post/…/request`, `async with … as s:`); `urllib.request.urlopen(url)` and `urllib.request.Request(url)`.\n- grpc: `grpc.insecure_channel(target)`, `grpc.secure_channel(target, …)`, and `grpc.aio` equivalents.\n- queue: `confluent_kafka.Producer(...).produce(topic, …)` and `Consumer(...).subscribe([topics])`; `kafka.KafkaProducer(...).send(topic, …)` and `KafkaConsumer(*topics, …)` / `.subscribe(...)`; pika `channel.basic_publish(exchange=…, routing_key=…)` (the routing key on the default exchange `\"\"`, else the exchange) and `basic_consume(queue=…)`; Celery `app.send_task(name, …)` (target = task name). Producers and consumers both count.\n- env: `os.environ[\"X\"]`, `os.environ.get(\"X\")`, `os.getenv(\"X\")` → kind env, target X, targetSource env.\n\nTargets: a string literal is `literal`; an env lookup passed as the URL/target is `env` with its key; `settings.X` (Django or pydantic settings object) is `config` with key `X`; an f-string or `+` concatenation whose first part is one of those takes that source and key; anything else is `unknown` with target `\"\"`. Confidence: `certain` when the receiver is the imported module (`import requests`, `import httpx as hx`, `from requests import Session`) or a name assigned from a known constructor in the same function or module scope (or an `async with … as` target); `likely` only for a method name no other listed client shares when the receiver is unknown; never beyond that. Out of scope: database and cache clients, boto3 and cloud SDKs.\n\nGoldens: a fixture covering every client and target rule above, including aliases, `async with`, a Session, the pika default exchange, an f-string with a settings prefix, an unknown target and a likely call.\n\nReport: `python-outbound-report.mjs` printing per corpus repo the outbound count by kind, client and confidence, targets by source, and 15 seeded samples with file:line. Log the numbers.\n\nPersisted bar (PR 14's wiring, no new sourcevision code expected; if any is needed, keep it in `pack-framework-facts.ts` and say why):\n- `sv analyze --fast` byte-identical to this branch's previous tip for every repo without Python and for Python repos without the pack.\n- With the pack, outbound.json differs only by added dependencies from Python files (test, docs and asset roles dropped by Hal's SKIP_ROLES); components.json unchanged by this task.\n- Analyze wall-clock on home-assistant with and without the pack, compared with PR 15b.\n- Root policy suites, lang-runtime, lang-python and sourcevision suites pass."
lastModified: "2026-10-16T01:17:07.007Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
