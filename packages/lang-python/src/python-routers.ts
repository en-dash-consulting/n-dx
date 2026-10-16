/**
 * The route rules FastAPI and Flask share: the applications and routers
 * (Flask's blueprints) a file makes, the routes their decorators declare,
 * and the mounts (`include_router`, `register_blueprint`) that give a
 * router its prefixes, followed across files.
 *
 * A decorator is a route only on a name bound to one of the framework's
 * constructors, in its own file or imported from another. A router no
 * mount reaches keeps its own prefix. A mount whose receiver is not a known
 * application (a subclass, a factory's result) mounts at the root. A router
 * mounted twice gets both prefixes.
 *
 * @module lang-python/python-routers
 */

import type { RouteFact } from "@n-dx/lang-kit";
import type { Capture, FrameworkContext, FrameworkFacts, PackSourceFile } from "@n-dx/lang-runtime";
import {
  argument,
  joinPrefix,
  joinWebPath,
  keptSubject,
  readWebFile,
  stringValue,
  webNotice,
  WebNotes,
  WebProject,
  webValue,
  type WebCall,
  type WebFile,
} from "./python-web.js";

/** Where an argument is: by position (when it may be positional) or by keyword. */
export interface ArgumentAt {
  readonly position?: number;
  readonly keyword: string;
}

/** A call that mounts a router on an application or another router. */
export interface MountRule {
  /** The method: `include_router`, `mount`, `register_blueprint`. */
  readonly method: string;
  readonly child: ArgumentAt;
  readonly prefix: ArgumentAt;
  /** Constructors a mounted child must come from; any of the framework's when absent. */
  readonly children?: ReadonlySet<string>;
  /** Whether a child that is not followed is counted in the notices (`mount` of static files is not). */
  readonly countUnfollowed: boolean;
}

export interface RouterRules {
  /** The framework's name in notices. */
  readonly name: string;
  /** The framework's query, whose name prefixes its captures. */
  readonly query: string;
  /** Each constructor, with the keyword its own prefix is given as. */
  readonly constructors: Readonly<Record<string, { readonly prefix?: string }>>;
  /** Decorator methods that fix the HTTP method. */
  readonly verbs: Readonly<Record<string, string>>;
  /** Decorator methods taking `methods=[…]`; GET when it is absent. */
  readonly anyVerb: ReadonlySet<string>;
  /** Where a route decorator's path is. */
  readonly path: ArgumentAt;
  readonly mounts: readonly MountRule[];
  /** `join`: a mount's prefix comes before the router's own (FastAPI); `replace`: it replaces it (Flask). */
  readonly mountPrefix: "join" | "replace";
}

/** An application or router bound to a name. */
interface Instance {
  readonly key: string;
  readonly file: string;
  /** The constructor that made it: `APIRouter`, `Blueprint`. */
  readonly madeBy: string;
  readonly prefix?: Capture;
}

interface Mount {
  readonly file: string;
  /** Absent when the receiver is not a known application or router: the root. */
  readonly parent?: Instance;
  readonly child: Instance;
  readonly prefix?: Capture;
}

const keyOf = (file: string, name: string): string => `${file}\0${name}`;

/** Every parsed file's routes, with the values kept in `${…}` form, skipped or not followed as notices. */
export function readRouterRoutes(rules: RouterRules, files: readonly PackSourceFile[], context: FrameworkContext | undefined): FrameworkFacts {
  const project = new WebProject(
    files.map((file) => readWebFile(file, rules.query)),
    context,
  );
  const kept = new WebNotes();
  const skipped = new WebNotes();
  const unfollowed = new WebNotes();

  const instances = new Map<string, Instance>();
  for (const web of project.files) {
    for (const assignment of web.assignments) {
      const call = web.callAt(assignment.value);
      const constructor = call && rules.constructors[call.callee];
      if (!call || !constructor) continue;
      const prefix = constructor.prefix === undefined ? undefined : call.keywords.get(constructor.prefix);
      const key = keyOf(web.path, assignment.target);
      instances.set(key, { key, file: web.path, madeBy: call.callee, ...(prefix ? { prefix } : {}) });
    }
  }
  const instanceAt = (file: string, text: string): Instance | undefined => {
    const found = project.defined(file, text, (f, name) => instances.has(keyOf(f, name)));
    return found && instances.get(keyOf(found.file, found.name));
  };

  const mounts: Mount[] = [];
  for (const web of project.files) {
    for (const call of web.calls) {
      const rule = rules.mounts.find((m) => m.method === call.callee);
      const childNode = rule && call.receiver !== undefined ? argument(call, rule.child.position, rule.child.keyword) : undefined;
      if (!rule || !childNode) continue;
      const child = instanceAt(web.path, childNode.text);
      if (!child || (rule.children && !rule.children.has(child.madeBy))) {
        if (rule.countUnfollowed) unfollowed.add(web.path, childNode, rule.method);
        continue;
      }
      const parent = instanceAt(web.path, call.receiver!);
      const prefix = argument(call, rule.prefix.position, rule.prefix.keyword);
      mounts.push({ file: web.path, child, ...(parent ? { parent } : {}), ...(prefix ? { prefix } : {}) });
    }
  }

  const valueText = (file: string, node: Capture, what: string): string => {
    const value = webValue(node);
    if (!value.literal) kept.add(file, node, what);
    return value.text;
  };

  /** Every full prefix of `instance`: through each mount that reaches it, else its own. */
  const prefixesOf = (instance: Instance, stack: ReadonlySet<string>): string[] => {
    const own = instance.prefix ? valueText(instance.file, instance.prefix, "prefix") : "";
    const out = new Set<string>();
    for (const mount of mounts.filter((m) => m.child === instance)) {
      if (mount.parent && stack.has(mount.parent.key)) continue; // a cycle mounts nothing
      const given = mount.prefix ? valueText(mount.file, mount.prefix, "prefix") : undefined;
      const local = rules.mountPrefix === "join" ? joinPrefix(given ?? "", own) : (given ?? own);
      const parents = mount.parent ? prefixesOf(mount.parent, new Set([...stack, mount.parent.key])) : [""];
      for (const parent of parents) out.add(joinPrefix(parent, local));
    }
    return out.size > 0 ? [...out] : [own];
  };
  const prefixCache = new Map<Instance, string[]>();
  const prefixes = (instance: Instance): string[] => {
    let found = prefixCache.get(instance);
    if (!found) prefixCache.set(instance, (found = prefixesOf(instance, new Set([instance.key]))));
    return found;
  };

  /** The HTTP methods of a decorator taking `methods=[…]`; literal entries only. */
  const methodsOf = (web: WebFile, call: WebCall): string[] => {
    const given = call.keywords.get("methods");
    if (!given) return ["GET"];
    const items = web.itemsOf(given);
    if (items.length === 0) {
      skipped.add(web.path, given, "methods");
      return [];
    }
    const methods = new Set<string>();
    for (const item of items) {
      const value = stringValue(item.text);
      if (value?.literal) methods.add(value.text.toUpperCase());
      else skipped.add(web.path, item, "method");
    }
    return [...methods];
  };

  const facts = new Map<string, { routes: RouteFact[] }>();
  for (const web of project.files) {
    const routes: RouteFact[] = [];
    for (const { decorator, handler } of web.decorated) {
      const call = web.callAt(decorator);
      if (!call?.receiver) continue;
      const fixed = rules.verbs[call.callee];
      if (fixed === undefined && !rules.anyVerb.has(call.callee)) continue;
      const instance = instanceAt(web.path, call.receiver);
      const pathNode = argument(call, rules.path.position, rules.path.keyword);
      if (!instance || !pathNode) continue;
      const methods = fixed === undefined ? methodsOf(web, call) : [fixed];
      const path = valueText(web.path, pathNode, "path");
      for (const prefix of prefixes(instance)) {
        for (const method of methods) routes.push({ method, path: joinWebPath(prefix, path), handler, position: decorator.start });
      }
    }
    facts.set(web.path, { routes });
  }

  const notices = [
    webNotice(rules.name, kept.list(), keptSubject),
    webNotice(rules.name, skipped.list(), (n) =>
      n === 1 ? "1 route method is not a literal and was skipped" : `${n} route methods are not literals and were skipped`,
    ),
    webNotice(rules.name, unfollowed.list(), (n) =>
      n === 1
        ? "1 mount names no application or router the rules can follow and was not followed"
        : `${n} mounts name no application or router the rules can follow and were not followed`,
    ),
  ].filter((n): n is string => n !== undefined);
  return { facts, notices };
}
