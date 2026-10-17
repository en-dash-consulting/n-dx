/**
 * FastAPI rules over the Python pack: request routes.
 *
 * A framework pack (lang-runtime's `FrameworkPack`): its query
 * (`queries/fastapi/fastapi.scm`) runs in the Python parse only when routes
 * are wanted. Rules (keys of {@link PROVENANCE}):
 *
 * - `routes`: `@X.get/post/put/delete/patch/options/head(path)` and
 *   `@X.api_route(path, methods=[…])` (GET without `methods`) on a name `X`
 *   bound to `FastAPI(…)` or `APIRouter(…)`; the handler is the decorated
 *   function. `APIRouter(prefix=…)` is the router's own prefix.
 * - `include-router`: `P.include_router(router, prefix=…)`, where `router`
 *   is a local name, a name imported from another file or `module.router`,
 *   followed through the pack's resolver. Its routes get P's prefixes, then
 *   the include's prefix, then their own.
 * - `mount`: `P.mount(path, app)` of another `FastAPI(…)` application.
 *
 * The shared mechanics (values, joins, notices) are in `python-routers.ts`.
 *
 * @module lang-python/fastapi
 */

import { join } from "node:path";
import type { FactKind } from "@n-dx/lang-kit";
import type { FrameworkContext, FrameworkFacts, FrameworkPack, PackSourceFile, RuleProvenance } from "@n-dx/lang-runtime";
import { PYTHON_PACKAGE } from "./package-paths.js";
import { readRouterRoutes, type RouterRules } from "./python-routers.js";

export const FASTAPI_QUERY = "fastapi";

const FASTAPI = ["FastAPI 0.115"];
const source = (path: string): string => `https://github.com/fastapi/fastapi/blob/0.115.0/${path}`;
const rule = (verifiedAgainst: readonly string[], url: string): RuleProvenance => ({ verifiedAgainst, verifiedOn: "2026-10-16", source: url });

const PROVENANCE: Readonly<Record<string, RuleProvenance>> = {
  [FASTAPI_QUERY]: rule(["tree-sitter-python@0.25.0", "Python 3.13"], "https://github.com/tree-sitter/tree-sitter-python/blob/v0.25.0/src/node-types.json"),
  // APIRoute: `methods` None is ["GET"]; add_api_route prepends the router's prefix to the path.
  routes: rule(FASTAPI, source("fastapi/routing.py")),
  // include_router: each included route's path is `prefix + route.path`.
  "include-router": rule(FASTAPI, "https://fastapi.tiangolo.com/tutorial/bigger-applications/"),
  // Starlette's mount, as FastAPI documents for sub-applications.
  mount: rule(FASTAPI, "https://fastapi.tiangolo.com/advanced/sub-applications/"),
};

export const FASTAPI_RULES: RouterRules = {
  name: "FastAPI",
  query: FASTAPI_QUERY,
  constructors: new Map([
    ["FastAPI", {}],
    ["APIRouter", { prefix: "prefix" }],
  ]),
  verbs: new Map(["get", "post", "put", "delete", "patch", "options", "head"].map((verb) => [verb, verb.toUpperCase()])),
  anyVerb: new Set(["api_route"]),
  path: { position: 0, keyword: "path" },
  mounts: [
    { method: "include_router", child: { position: 0, keyword: "router" }, prefix: { keyword: "prefix" }, countUnfollowed: true },
    // `app.mount("/static", StaticFiles(…))` mounts no routes, so a child that is no application is not counted.
    {
      method: "mount",
      child: { position: 1, keyword: "app" },
      prefix: { position: 0, keyword: "path" },
      children: new Set(["FastAPI"]),
      countUnfollowed: false,
    },
  ],
  mountPrefix: "join",
};

export const fastapi: FrameworkPack = {
  id: "fastapi",
  produces: ["routes"],
  // A getter, so the path is computed on first use rather than at import.
  get queries() {
    return [{ name: FASTAPI_QUERY, path: join(PYTHON_PACKAGE.queryDir("fastapi"), `${FASTAPI_QUERY}.scm`) }];
  },
  provenance: PROVENANCE,
  read(files: readonly PackSourceFile[], kinds: readonly FactKind[], context?: FrameworkContext): FrameworkFacts {
    return kinds.includes("routes") ? readRouterRoutes(FASTAPI_RULES, files, context) : { facts: new Map(), notices: [] };
  },
};
