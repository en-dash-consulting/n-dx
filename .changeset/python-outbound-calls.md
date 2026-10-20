---
"@n-dx/lang-python": patch
"@n-dx/sourcevision": patch
---

The Python pack produces `outboundCalls` through a python-clients framework pack, so a Python repository's outbound calls reach outbound.json: `requests`, `httpx` and `aiohttp` HTTP calls (module functions, sessions and clients, `async with` included), `urllib.request`, gRPC channels, confluent_kafka and kafka-python producers and consumers, pika `basic_publish`/`basic_consume`, Celery `send_task` and `os.environ`/`os.getenv` lookups. Targets are literal, env, `settings.X` config or unknown, and confidence is `certain` for an imported module or a bound client, `likely` only for `basic_publish`, `basic_consume` and `send_task` on an unknown receiver. Without the Python pack, or in a repository without Python, every artifact is unchanged.
