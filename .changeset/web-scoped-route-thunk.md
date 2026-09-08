---
"@n-dx/web": patch
---

Make `handleScopedRoute` take a thunk, so an out-of-scope route cannot run.

The helper took the handler's *result*, which meant every call site had already
invoked its handler before the scope guard was read. On a false guard the
promise was neither awaited nor cancelled: the handler ran on, wrote to a
response the dispatcher's 404 fall-through had already finished, and threw
`ERR_HTTP_HEADERS_SENT` from an unawaited promise — which ends the process on
Node 22.

Probing the previous build under `--scope` showed `/api/notion/*` and
`/api/merge-graph` were reachable this way. The other scoped routes escaped only
because they do not accept POST on the paths probed and so returned without
writing — luck, not a guard, and it held whether or not the project was
initialised.

The parameter is now `() => RouteResult`, invoked only when the guard passes, so
passing an already-invoked handler is a compile error (`TS2345`) rather than a
latent crash. All eleven call sites are migrated, including the ask route, whose
one-off inline guard from the previous fix is folded back into the shared
mechanism.

Also removes `resolveRouteResult`, a no-op ternary whose two branches were
identical (`result instanceof Promise ? result : result`) and whose only caller
was this helper — `await run()` covers both sync and async handlers.

`tests/integration/scoped-route-dispatch.test.ts` gains cases for the two
reachable routes; it boots the real server in a child process, because the
per-route unit tests mount handlers directly and never touch the dispatcher.
