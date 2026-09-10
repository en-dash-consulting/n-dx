---
"@n-dx/web": patch
---

Stop an out-of-scope POST to `/api/sourcevision/ask` from killing the server.

`handleApiRoutes` gated the ask route with
`handleScopedRoute(isInScope(...), handleSourcevisionAskRoute(req, res, ctx))`.
The second argument is a value, so the handler was invoked before the guard was
read. With `--scope=rex` (or any scope excluding sourcevision) the handler ran
anyway, reached the model call, and then wrote to a response the dispatcher's
404 fall-through had already finished — throwing `ERR_HTTP_HEADERS_SENT` from an
unawaited promise, which terminates the process on Node 22. One local POST took
down the dashboard, having first paid for an answer nobody received.

The scope check now happens before the handler is invoked, matching the
synchronous siblings on either side of it.

The eager-evaluation shape is not unique to this route — `handleScopedRoute` has
it at every call site, and the same crash reproduces on `/api/notion/sync` under
`--scope=sourcevision`. That is pre-existing and tracked separately; this change
fixes only the route that reaches an LLM, and leaves a comment at the call site
explaining why the guard is inline rather than delegated.

Covered by `tests/integration/scoped-route-dispatch.test.ts`, which boots the
real server in a child process — the existing ask-route tests mount the handler
directly and never touch the dispatcher, which is why they passed throughout.
