/**
 * Flask rules over the Python pack: request routes.
 *
 * A framework pack (lang-runtime's `FrameworkPack`): its query
 * (`queries/flask/flask.scm`) runs in the Python parse only when routes are
 * wanted. Rules (keys of {@link PROVENANCE}):
 *
 * - `routes`: `@X.route(rule, methods=[…])` on a name `X` bound to
 *   `Flask(…)` or `Blueprint(…)`, GET without `methods` (Flask's default, so
 *   the method is set, not absent), and Flask 2's `@X.get/post/put/delete/patch(rule)`.
 *   The handler is the decorated function. `Blueprint(…, url_prefix=…)` is
 *   the blueprint's own prefix.
 * - `register-blueprint`: `P.register_blueprint(bp, url_prefix=…)`, where
 *   `bp` is a local name, a name imported from another file or `module.bp`,
 *   followed through the pack's resolver. A registration's `url_prefix`
 *   replaces the blueprint's own; a blueprint registered on another gets
 *   that one's prefixes before its own.
 *
 * The shared mechanics (values, joins, notices) are in `python-routers.ts`.
 *
 * @module lang-python/flask
 */

import { join } from "node:path";
import type { FactKind } from "@n-dx/lang-kit";
import type { FrameworkContext, FrameworkFacts, FrameworkPack, PackSourceFile, RuleProvenance } from "@n-dx/lang-runtime";
import { PYTHON_PACKAGE } from "./package-paths.js";
import { readRouterRoutes, type RouterRules } from "./python-routers.js";

export const FLASK_QUERY = "flask";

const FLASK = ["Flask 3.1"];
const source = (path: string): string => `https://github.com/pallets/flask/blob/3.1.0/${path}`;
const rule = (verifiedAgainst: readonly string[], url: string): RuleProvenance => ({ verifiedAgainst, verifiedOn: "2026-10-16", source: url });

const PROVENANCE: Readonly<Record<string, RuleProvenance>> = {
  [FLASK_QUERY]: rule(["tree-sitter-python@0.25.0", "Python 3.13"], "https://github.com/tree-sitter/tree-sitter-python/blob/v0.25.0/src/node-types.json"),
  // Scaffold.route and the get/post/… shortcuts; a rule without `methods` is ("GET",).
  routes: rule(FLASK, source("src/flask/sansio/scaffold.py")),
  // BlueprintSetupState: the registration's url_prefix, else the blueprint's; nested prefixes joined by one slash.
  "register-blueprint": rule(FLASK, source("src/flask/sansio/blueprints.py")),
};

export const FLASK_RULES: RouterRules = {
  name: "Flask",
  query: FLASK_QUERY,
  constructors: new Map([
    ["Flask", {}],
    ["Blueprint", { prefix: "url_prefix" }],
  ]),
  verbs: new Map(["get", "post", "put", "delete", "patch"].map((verb) => [verb, verb.toUpperCase()])),
  anyVerb: new Set(["route"]),
  path: { position: 0, keyword: "rule" },
  mounts: [
    { method: "register_blueprint", child: { position: 0, keyword: "blueprint" }, prefix: { keyword: "url_prefix" }, countUnfollowed: true },
  ],
  mountPrefix: "replace",
};

export const flask: FrameworkPack = {
  id: "flask",
  produces: ["routes"],
  // A getter, so the path is computed on first use rather than at import.
  get queries() {
    return [{ name: FLASK_QUERY, path: join(PYTHON_PACKAGE.queryDir("flask"), `${FLASK_QUERY}.scm`) }];
  },
  provenance: PROVENANCE,
  read(files: readonly PackSourceFile[], kinds: readonly FactKind[], context?: FrameworkContext): FrameworkFacts {
    return kinds.includes("routes") ? readRouterRoutes(FLASK_RULES, files, context) : { facts: new Map(), notices: [] };
  },
};
