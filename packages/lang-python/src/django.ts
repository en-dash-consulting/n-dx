/**
 * Django rules over the Python pack: request routes from URLconfs.
 *
 * A framework pack (lang-runtime's `FrameworkPack`): its query
 * (`queries/django/django.scm`) runs in the Python parse only when routes
 * are wanted. Rules (keys of {@link PROVENANCE}):
 *
 * - `urlpatterns`: the entries of `urlpatterns` (a list, lists joined by
 *   `+`, and `urlpatterns += [...]`) that are `path(route, view)` or
 *   `re_path(regex, view)`. An assignment whose value builds on
 *   `urlpatterns` (`urlpatterns + static(…)`, `urlpatterns + [...]`,
 *   `format_suffix_patterns(urlpatterns)`) keeps the earlier entries and
 *   appends its lists; any other replaces them, and one that leaves none
 *   where there were some is counted in a notice. A route has no method (any); its handler is the
 *   view reduced to its last name (`views.SiteListView.as_view()` →
 *   `SiteListView`, `views.home` → `home`), and absent for any other call.
 *   A `re_path` regex is kept as written.
 * - `include`: a view `include(…)` adds the included patterns under the
 *   entry's route: a dotted string (`"app.urls"`) found through the pack's
 *   resolver, an imported module (`include(urls)`, `include(app.urls)`), a
 *   list (inline, or a name bound to one here or in another file), or a
 *   `(patterns, app_name)` tuple of any of these. A view `X.urls`
 *   (`admin.site.urls`) is an include too, as Django treats the tuple it
 *   is. A URLconf included twice gives both paths; a target not found is
 *   counted in a notice.
 * - `root-urlconf`: walking starts at the module a settings module's
 *   `ROOT_URLCONF = "…"` literal names; without one that resolves, at each
 *   module setting `urlpatterns` that no other includes.
 * - `drf-router`: `router.register(…)` on a name bound to a `…Router(…)`
 *   (Django REST framework's routers), in the same file or imported from
 *   the one that binds it, is counted in a notice and not
 *   expanded; `include(router.urls)` is left out without a notice.
 *
 * @module lang-python/django
 */

import { join } from "node:path";
import type { FactKind, RouteFact } from "@n-dx/lang-kit";
import {
  contains,
  type Capture,
  type FrameworkContext,
  type FrameworkFacts,
  type FrameworkPack,
  type PackSourceFile,
  type RuleProvenance,
} from "@n-dx/lang-runtime";
import { PYTHON_PACKAGE } from "./package-paths.js";
import {
  argument,
  dotted,
  joinPrefix,
  joinWebPath,
  keptSubject,
  lastName,
  readWebFile,
  stringValue,
  webNotice,
  WebNotes,
  WebProject,
  webValue,
  type WebFile,
} from "./python-web.js";

export const DJANGO_QUERY = "django";

const DJANGO = ["Django 5.2"];
const docs = (path: string): string => `https://docs.djangoproject.com/en/5.2/${path}`;
const rule = (verifiedAgainst: readonly string[], url: string): RuleProvenance => ({ verifiedAgainst, verifiedOn: "2026-10-16", source: url });

const PROVENANCE: Readonly<Record<string, RuleProvenance>> = {
  [DJANGO_QUERY]: rule(["tree-sitter-python@0.25.0", "Python 3.13"], "https://github.com/tree-sitter/tree-sitter-python/blob/v0.25.0/src/node-types.json"),
  urlpatterns: rule(DJANGO, docs("ref/urls/")),
  // include(): a module, its dotted path, a pattern list, or a (patterns, app_name) tuple; the remainder of the URL is matched against it.
  include: rule(DJANGO, docs("ref/urls/#include")),
  "root-urlconf": rule(DJANGO, docs("ref/settings/#root-urlconf")),
  "drf-router": rule(["Django REST framework 3.15"], "https://www.django-rest-framework.org/api-guide/routers/"),
};

/** Where an include's patterns are: the entries of one list, or of a module's `urlpatterns`. */
interface Source {
  readonly key: string;
  readonly file: string;
  readonly entries: readonly Capture[];
}

/** An include target: patterns, a DRF router's `urls` (left out), or not followed. */
type Target = Source | "router" | undefined;

const URLPATTERNS = "urlpatterns";
const PATTERN_CALLS: ReadonlySet<string> = new Set(["path", "re_path"]);

/** What one file declares for the rules. */
interface UrlConf {
  readonly web: WebFile;
  /** The entries of `urlpatterns`, in document order; undefined when the file sets none. */
  readonly urlpatterns?: readonly Capture[];
  /** Names bound to a list, last binding wins. */
  readonly lists: ReadonlyMap<string, Capture>;
  /** Names bound to a Django REST framework router. */
  readonly routers: ReadonlySet<string>;
}

/** The lists a `urlpatterns` value is made of: itself, or the list operands of `+`; not lists inside a call or another list. */
function patternLists(web: WebFile, value: Capture): Capture[] {
  if (value.nodeType === "list") return [value];
  const calls = web.calls.map((c) => c.invocation).filter((i) => contains(value, i));
  const lists = web.sequences.filter((s) => s.nodeType === "list" && contains(value, s));
  return lists.filter((list) => !calls.some((c) => contains(c, list)) && !lists.some((other) => other !== list && contains(other, list)));
}

/**
 * Whether a `urlpatterns` value builds on the entries before it: one of `selves` (`urlpatterns` as an
 * operand of `+` or a call's argument) is within it and not inside a pattern list, which starts afresh.
 */
function extendsItself(web: WebFile, value: Capture, selves: readonly Capture[]): boolean {
  const lists = web.sequences.filter((s) => s.nodeType === "list" && contains(value, s));
  return selves.some((self) => contains(value, self) && !lists.some((list) => contains(list, self)));
}

/** `selves` are the file's `@django.self` captures; an assignment that leaves no entries where there were some is noted in `dropped`. */
function readUrlConf(web: WebFile, selves: readonly Capture[], dropped: WebNotes): UrlConf {
  let urlpatterns: Capture[] | undefined;
  const lists = new Map<string, Capture>();
  const routers = new Set<string>();
  for (const { target, value, augmented } of web.assignments) {
    if (target === URLPATTERNS) {
      const entries = patternLists(web, value).flatMap((list) => web.itemsOf(list));
      const extend = augmented || extendsItself(web, value, selves);
      if (!extend && entries.length === 0 && (urlpatterns?.length ?? 0) > 0) dropped.add(web.path, value, "urlpatterns =");
      urlpatterns = extend ? [...(urlpatterns ?? []), ...entries] : entries;
      continue;
    }
    if (value.nodeType === "list") lists.set(target, value);
    const call = web.callAt(value);
    if (call && call.callee.endsWith("Router") && call.callee !== "APIRouter") routers.add(target);
  }
  return { web, ...(urlpatterns ? { urlpatterns } : {}), lists, routers };
}

/** A view reduced to its last name; undefined for a call other than `.as_view(…)`, a lambda or a string. */
function viewName(web: WebFile, view: Capture): string | undefined {
  if (view.nodeType === "identifier" || view.nodeType === "attribute") return lastName(view.text);
  const call = view.nodeType === "call" ? web.callAt(view) : undefined;
  return call?.callee === "as_view" && call.receiver ? lastName(call.receiver) : undefined;
}

/** Every parsed file's routes, with what was kept in `${…}` form, not followed or counted as notices. */
export function readDjangoRoutes(files: readonly PackSourceFile[], context: FrameworkContext | undefined): FrameworkFacts {
  const project = new WebProject(
    files.map((file) => readWebFile(file, DJANGO_QUERY)),
    context,
  );
  const selves = new Map(files.map((file) => [file.path, (file.captures[DJANGO_QUERY] ?? []).filter((c) => c.name === "django.self")]));
  const dropped = new WebNotes();
  const confs = new Map(project.files.map((web) => [web.path, readUrlConf(web, selves.get(web.path) ?? [], dropped)]));
  const kept = new WebNotes();
  const unfollowed = new WebNotes();
  const registered = new WebNotes();

  const moduleSource = (file: string): Source => ({ key: file, file, entries: confs.get(file)?.urlpatterns ?? [] });
  const listSource = (file: string, name: string): Source =>
    name === URLPATTERNS
      ? moduleSource(file)
      : { key: `${file}\0${name}`, file, entries: confs.get(file)!.web.itemsOf(confs.get(file)!.lists.get(name)!) };
  const hasList = (file: string, name: string): boolean =>
    name === URLPATTERNS ? confs.get(file)?.urlpatterns !== undefined : (confs.get(file)?.lists.has(name) ?? false);
  /** Whether `text` written in `file` names a router, bound there or imported from where it is. */
  const isRouter = (file: string, text: string): boolean =>
    project.defined(file, text, (f, name) => confs.get(f)?.routers.has(name) ?? false) !== undefined;

  /** What `include(node)` in `file` adds. */
  const targetOf = (file: string, node: Capture): Target => {
    const conf = confs.get(file)!;
    switch (node.nodeType) {
      case "string":
      case "concatenated_string": {
        const value = stringValue(node.text);
        const module = value?.literal ? project.module(file, value.text) : undefined;
        return module === undefined ? undefined : moduleSource(module);
      }
      case "tuple": {
        const first = conf.web.itemsOf(node)[0];
        return first === undefined ? undefined : targetOf(file, first);
      }
      case "list":
        return { key: `${file}\0${node.start.line}:${node.start.column}`, file, entries: conf.web.itemsOf(node) };
      case "identifier":
      case "attribute": {
        const segments = dotted(node.text).split(".");
        if (segments.length >= 2 && segments.at(-1) === "urls" && isRouter(file, segments.slice(0, -1).join("."))) return "router";
        const module = project.moduleOf(file, segments);
        if (module !== undefined) return moduleSource(module);
        const list = project.defined(file, node.text, hasList);
        return list && listSource(list.file, list.name);
      }
      default:
        return undefined;
    }
  };

  interface Pattern {
    readonly file: string;
    readonly call: Capture;
    readonly route: Capture;
    /** The include's argument for an include, else the view. */
    readonly include?: Capture;
    readonly handler?: string;
  }
  /** The `path`/`re_path` entries of a source, read once each. */
  const patternCache = new Map<string, Pattern[]>();
  const patternsOf = (source: Source): Pattern[] => {
    const cached = patternCache.get(source.key);
    if (cached) return cached;
    const web = confs.get(source.file)!.web;
    const patterns = source.entries.flatMap((entry): Pattern[] => {
      const call = web.callAt(entry);
      if (!call || !PATTERN_CALLS.has(call.callee)) return [];
      const route = argument(call, 0, "route");
      const view = argument(call, 1, "view");
      if (!route || !view) return [];
      const included = view.nodeType === "call" ? web.callAt(view) : undefined;
      if (included?.callee === "include") {
        return [{ file: source.file, call: entry, route, include: argument(included, 0, "arg") ?? view }];
      }
      // `admin.site.urls`, `router.urls`: the (patterns, app_name, namespace) include() returns, passed directly.
      if (view.nodeType === "attribute" && lastName(view.text) === "urls") return [{ file: source.file, call: entry, route, include: view }];
      const handler = viewName(web, view);
      return [{ file: source.file, call: entry, route, ...(handler === undefined ? {} : { handler }) }];
    });
    patternCache.set(source.key, patterns);
    return patterns;
  };

  // Where walking starts: ROOT_URLCONF, else each URLconf no other includes.
  const roots: Source[] = [];
  for (const { web } of confs.values()) {
    for (const { target, value } of web.assignments) {
      const named = target === "ROOT_URLCONF" ? stringValue(value.text) : undefined;
      const module = named?.literal ? project.module(web.path, named.text) : undefined;
      if (module !== undefined && confs.get(module)?.urlpatterns && !roots.some((r) => r.key === module)) roots.push(moduleSource(module));
    }
  }
  if (roots.length === 0) {
    const included = new Set<string>();
    for (const conf of confs.values()) {
      if (!conf.urlpatterns) continue;
      for (const pattern of patternsOf(moduleSource(conf.web.path))) {
        const target = pattern.include && targetOf(pattern.file, pattern.include);
        if (typeof target === "object" && target.key === target.file) included.add(target.file);
      }
    }
    for (const conf of confs.values()) if (conf.urlpatterns && !included.has(conf.web.path)) roots.push(moduleSource(conf.web.path));
  }

  const routes = new Map<string, Map<string, RouteFact>>();
  const walk = (source: Source, prefix: string, stack: ReadonlySet<string>): void => {
    for (const pattern of patternsOf(source)) {
      const value = webValue(pattern.route);
      if (!value.literal) kept.add(pattern.file, pattern.route, pattern.include ? "prefix" : "path");
      if (pattern.include) {
        const target = targetOf(pattern.file, pattern.include);
        if (target === undefined) unfollowed.add(pattern.file, pattern.include, "include");
        else if (target !== "router" && !stack.has(target.key)) walk(target, joinPrefix(prefix, value.text), new Set([...stack, target.key]));
        continue;
      }
      const path = joinWebPath(prefix, value.text);
      const fact: RouteFact = { path, ...(pattern.handler === undefined ? {} : { handler: pattern.handler }), position: pattern.call.start };
      const inFile = routes.get(pattern.file) ?? new Map<string, RouteFact>();
      inFile.set(`${fact.position.line}:${fact.position.column} ${path}`, fact);
      routes.set(pattern.file, inFile);
    }
  };
  for (const root of roots) walk(root, "", new Set([root.key]));

  for (const conf of confs.values()) {
    for (const call of conf.web.calls) {
      if (call.callee === "register" && call.receiver !== undefined && isRouter(conf.web.path, call.receiver)) {
        registered.add(conf.web.path, call.invocation, "register", `${call.receiver}.register`);
      }
    }
  }

  const facts = new Map(
    project.files.map((web) => {
      const found = [...(routes.get(web.path)?.values() ?? [])].sort(
        (a, b) => a.position.line - b.position.line || a.position.column - b.position.column || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
      );
      return [web.path, { routes: found }] as const;
    }),
  );
  const notices = [
    webNotice("Django", kept.list(), keptSubject),
    webNotice("Django", unfollowed.list(), (n) =>
      n === 1 ? "1 include() target is not one the rules can follow and was not followed" : `${n} include() targets are not ones the rules can follow and were not followed`,
    ),
    webNotice("Django", registered.list(), (n) =>
      n === 1
        ? "1 Django REST framework router registration is counted, not expanded"
        : `${n} Django REST framework router registrations are counted, not expanded`,
    ),
    webNotice("Django", dropped.list(), (n) =>
      n === 1
        ? "1 urlpatterns assignment drops the patterns set before it and adds none the rules can read"
        : `${n} urlpatterns assignments drop the patterns set before them and add none the rules can read`,
    ),
  ].filter((n): n is string => n !== undefined);
  return { facts, notices };
}

export const django: FrameworkPack = {
  id: "django",
  produces: ["routes"],
  // A getter, so the path is computed on first use rather than at import.
  get queries() {
    return [{ name: DJANGO_QUERY, path: join(PYTHON_PACKAGE.queryDir("django"), `${DJANGO_QUERY}.scm`) }];
  },
  provenance: PROVENANCE,
  read(files: readonly PackSourceFile[], kinds: readonly FactKind[], context?: FrameworkContext): FrameworkFacts {
    return kinds.includes("routes") ? readDjangoRoutes(files, context) : { facts: new Map(), notices: [] };
  },
};
