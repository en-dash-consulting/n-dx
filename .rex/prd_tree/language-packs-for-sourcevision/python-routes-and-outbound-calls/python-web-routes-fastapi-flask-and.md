---
id: "e589b220-a46e-4cd2-89e6-3da637ca39fe"
level: "task"
title: "Python web routes: FastAPI, Flask and Django framework packs"
status: "completed"
priority: "medium"
tags:
  - "language-packs"
  - "lang-python"
  - "frameworks"
  - "pr-16"
source: "roadmap"
startedAt: "2026-10-16T00:04:25.569Z"
completedAt: "2026-10-16T00:36:38.512Z"
endedAt: "2026-10-16T00:36:38.512Z"
resolutionType: "code-change"
resolutionDetail: "FastAPI, Flask and Django framework packs produce routes with cross-file mounting via the new optional FrameworkContext. Corpus pinning, the report run and the byte-identity runs are moved to 4118bd59, because they need the network."
acceptanceCriteria:
  - "fastapi, flask and django framework packs in @n-dx/lang-python produce routes facts with provenance per rule; the Python pack lists routes in produces"
  - "FrameworkPack.read takes an optional resolver context (additive); include_router, register_blueprint and Django include are followed across files; Spring Boot's golden is unchanged"
  - "Non-literal prefixes and paths are kept in ${expression} form and counted; DRF router registrations are counted, not expanded"
  - "CTFd and Netflix/dispatch join the pinned corpus; the routes report logs per-repo counts, notices and a 15-route hand-checked sample"
  - "Byte-identical to PR 15b without Python or without the pack; with the pack only Python serverRoutes groups and the derived count are added; suites pass"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
description: "Add `routes` facts to `@n-dx/lang-python` through lang-runtime's `FrameworkPack` slot, following `packages/lang-java/src/spring-boot.ts` for structure (provenance per rule, its own query file under `queries/<framework>/`, run only when `routes` is asked for, skipped values reported in the entry's `notices`). One framework pack each: `fastapi`, `flask`, `django`. Add `routes` to the Python pack's `produces`.\n\nCross-file context: `FrameworkPack.read(files, kinds)` gains an optional third argument (lang-runtime, additive), e.g. `{ resolve(fromFile) }` from the pack's prepared resolver, so a framework can follow `from app.api.routes import items` or a dotted module string to a parsed file. Spring Boot ignores it; its golden must not change.\n\nFastAPI:\n- Route decorators on names bound to `FastAPI(...)` or `APIRouter(...)`: `.get/.post/.put/.delete/.patch/.options/.head(path)` and `.api_route(path, methods=[...])`.\n- `APIRouter(prefix=...)`; `X.include_router(router, prefix=...)` where `router` is a local name or `module.router` imported from another file (followed through the resolver). A router included twice yields both paths. Handler = the decorated function's name.\n\nFlask:\n- `@app.route(path, methods=[...])` on `Flask(...)` or `Blueprint(...)` instances, no `methods` = GET (Flask's default, so the method is set, not absent); Flask 2 `@app.get/post/put/delete/patch`.\n- `Blueprint(name, import_name, url_prefix=...)` and `app.register_blueprint(bp, url_prefix=...)` across files.\n\nDjango:\n- `urlpatterns` (list or `+=`) with `path(route, view)` and `re_path(regex, view)`; `include(\"app.urls\")` (dotted string resolved to a parsed module through the resolver's roots) and `include(module)`/`include((patterns, app_name))` through imports, joined to the including route's prefix. `re_path` regexes are kept as written. The root URLconf is `ROOT_URLCONF` when a settings module gives it as a literal, otherwise each `urls.py` that no other includes. Method absent (any). Handler = the view as written, reduced to its last name (`views.SiteListView.as_view()` → `SiteListView`, `views.home` → `home`).\n\nPaths: join prefix and path with exactly one slash (Spring's `joinRoutePath` rule; Django keeps its trailing slashes). A literal is used as written; a prefix or path that is not a literal is kept as written in Spring placeholder form `${expression}` (e.g. FastAPI's `${settings.API_V1_STR}/items/`) and counted in the notices. Django REST framework `router.register(...)` calls are counted in a notice and not expanded. Out of scope: aiohttp/Starlette route tables, class-level `url` attributes (Home Assistant views), GraphQL, websockets.\n\nGoldens: fixtures per framework covering every rule above (cross-file include_router and register_blueprint, Django include by string and by module, a non-literal prefix, a router mounted twice, Flask default GET, DRF register notice).\n\nCorpus: add CTFd/CTFd (Flask) and Netflix/dispatch (FastAPI) to `packages/sourcevision/scripts/python-corpus.json` (pinned commits) and clone them. A `python-routes-report.mjs` beside `spring-corpus-report.mjs` prints per repo the route count by framework and method, placeholder paths, notices, and 15 seeded sample routes with file:line. Log the numbers.\n\nPersisted bar (PR 14's wiring, no new sourcevision code expected; if any is needed, keep it in `pack-framework-facts.ts` and say why):\n- `sv analyze --fast` byte-identical to PR 15b for every repo without Python and for Python repos without the pack.\n- With the pack, components.json differs from PR 15b only by added `serverRoutes` groups for Python files and the derived `summary.totalServerRoutes`; outbound.json unchanged in this task.\n- Root policy suites, lang-runtime, lang-java, lang-python and sourcevision suites pass."
lastModified: "2026-10-16T00:36:38.785Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
