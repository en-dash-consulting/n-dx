/**
 * Route detection for React Router v7 / Remix.
 * File-based route pattern parsing, config-based route parsing,
 * and route tree construction.
 */

import { join, relative, extname } from "node:path";
import { existsSync } from "node:fs";
import ts from "typescript";
import { toPosix } from "../util/paths.js";
import type {
  RouteExportKind,
  RouteModule,
  RouteTreeNode,
} from "../schema/index.js";

// ── Known convention export names ──────────────────────────────────────────

export const ROUTE_EXPORT_NAMES = new Set<string>([
  "loader",
  "action",
  "meta",
  "links",
  "headers",
  "ErrorBoundary",
  "shouldRevalidate",
  "handle",
  "HydrateFallback",
]);

// ── parseFileRoutePattern ───────────────────────────────────────────────────

export function parseFileRoutePattern(
  filePath: string,
  routesDir: string
): string | null {
  // filePath should be relative to routesDir
  let rel = toPosix(relative(routesDir, filePath));
  if (rel.startsWith("..")) return null;

  // Remove extension
  const ext = extname(rel);
  rel = rel.slice(0, -ext.length);

  // Handle index routes
  if (rel === "_index" || rel === "index") return "/";

  // Split on dots (Remix flat-file convention: a.b.c → /a/b/c)
  const dotSegments = rel.split(".");

  // Remove trailing "_index" segment (e.g. users._index → /users)
  if (dotSegments[dotSegments.length - 1] === "_index") {
    dotSegments.pop();
  }

  const pathSegments: string[] = [];
  let isLayout = false;

  for (let i = 0; i < dotSegments.length; i++) {
    let seg = dotSegments[i];

    // Leading underscore = pathless layout (e.g. _auth → no path segment)
    if (seg.startsWith("_") && i === 0) {
      isLayout = true;
      continue;
    }

    // Trailing underscore escape: $id_ means the param doesn't create nesting
    if (seg.endsWith("_") && seg.length > 1) {
      seg = seg.slice(0, -1);
    }

    // Dynamic segments: $param → :param
    if (seg.startsWith("$")) {
      if (seg === "$") {
        // Splat/catch-all
        pathSegments.push("*");
      } else {
        const paramName = seg.slice(1);
        pathSegments.push(`:${paramName}`);
      }
      continue;
    }

    // Optional segments: ($param) → :param?
    if (seg.startsWith("(") && seg.endsWith(")")) {
      const inner = seg.slice(1, -1);
      if (inner.startsWith("$")) {
        pathSegments.push(`:${inner.slice(1)}?`);
      } else {
        pathSegments.push(inner);
      }
      continue;
    }

    // Splat catch-all: [...] → *
    if (seg === "[...]") {
      pathSegments.push("*");
      continue;
    }

    pathSegments.push(seg);
  }

  if (isLayout && pathSegments.length === 0) {
    return null; // pathless layout has no route pattern of its own
  }

  return "/" + pathSegments.join("/");
}

// ── buildRouteTree ──────────────────────────────────────────────────────────

export function buildRouteTree(routeModules: RouteModule[]): RouteTreeNode[] {
  // Build parent→children map
  const childrenOf = new Map<string | null, RouteModule[]>();
  for (const mod of routeModules) {
    const parent = mod.parentLayout;
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent)!.push(mod);
  }

  const cmp = (a: RouteTreeNode, b: RouteTreeNode) =>
    a.routePattern < b.routePattern ? -1 : a.routePattern > b.routePattern ? 1 : 0;

  function buildNodes(parentFile: string | null): RouteTreeNode[] {
    const children = childrenOf.get(parentFile) || [];
    const nodes: RouteTreeNode[] = [];

    for (const m of children) {
      if (m.routePattern !== null) {
        // Routed module — becomes a tree node with its own children
        nodes.push({
          file: m.file,
          routePattern: m.routePattern,
          children: buildNodes(m.file).sort(cmp),
        });
      } else {
        // Pathless layout (null pattern) — promote its children to this level
        nodes.push(...buildNodes(m.file));
      }
    }

    return nodes.sort(cmp);
  }

  return buildNodes(null);
}

// ── React Router v7 config-based routes ─────────────────────────────────────

/**
 * Search for a routes.ts config file used by React Router v7 config-based routing.
 * Returns the file path (relative to targetDir) and the app directory, or null.
 */
export function findRoutesConfig(targetDir: string): { file: string; appDir: string } | null {
  const candidates: Array<{ file: string; appDir: string }> = [
    { file: "app/routes.ts", appDir: "app" },
    { file: "app/routes.tsx", appDir: "app" },
    { file: "routes.ts", appDir: "." },
    { file: "routes.tsx", appDir: "." },
    { file: "src/routes.ts", appDir: "src" },
    { file: "src/routes.tsx", appDir: "src" },
  ];

  for (const candidate of candidates) {
    if (existsSync(join(targetDir, candidate.file))) {
      return candidate;
    }
  }

  return null;
}

/**
 * Parse a React Router v7 routes.ts config file and return RouteModule[] or null.
 *
 * Returns null if:
 * - No default export found
 * - Default export is a flatRoutes() call (should fall back to file-based)
 * - Parse fails entirely
 *
 * Handles: route(), index(), layout(), ...prefix(), satisfies/as wrappers.
 */
export function parseRoutesConfig(sourceText: string, configDir: string): RouteModule[] | null {
  const sf = ts.createSourceFile(
    "routes.ts",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  // Find default export expression
  let defaultExpr: ts.Expression | null = null;

  for (const stmt of sf.statements) {
    // export default [...]
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      defaultExpr = stmt.expression;
      break;
    }
    // export default function / export default class (not array — skip)
  }

  if (!defaultExpr) return null;

  // Unwrap `satisfies RouteConfig` or `as RouteConfig`
  while (
    ts.isSatisfiesExpression(defaultExpr) ||
    ts.isAsExpression(defaultExpr)
  ) {
    defaultExpr = defaultExpr.expression;
  }

  // If it's a call expression, check for flatRoutes()
  if (ts.isCallExpression(defaultExpr)) {
    const callee = defaultExpr.expression;
    const calleeName = ts.isIdentifier(callee) ? callee.text
      : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name) ? callee.name.text
      : "";
    if (calleeName === "flatRoutes") return null;
    // Other call expressions — can't parse
    return null;
  }

  // Must be an array literal
  if (!ts.isArrayLiteralExpression(defaultExpr)) return null;

  const modules: RouteModule[] = [];

  function resolveFilePath(file: string): string {
    return configDir === "." ? file : toPosix(join(configDir, file));
  }

  function processElements(
    elements: ts.NodeArray<ts.Expression>,
    parentLayout: string | null,
    prefixPath: string | null,
  ): void {
    for (const el of elements) {
      // Handle ...prefix("path", [...]) — SpreadElement
      if (ts.isSpreadElement(el)) {
        const spreadExpr = el.expression;
        if (ts.isCallExpression(spreadExpr)) {
          const callee = spreadExpr.expression;
          const name = ts.isIdentifier(callee) ? callee.text : "";
          if (name === "prefix" && spreadExpr.arguments.length >= 2) {
            const pathArg = spreadExpr.arguments[0];
            const childrenArg = spreadExpr.arguments[1];
            if (ts.isStringLiteral(pathArg) && ts.isArrayLiteralExpression(childrenArg)) {
              const combinedPrefix = prefixPath
                ? prefixPath + "/" + pathArg.text
                : pathArg.text;
              processElements(childrenArg.elements, parentLayout, combinedPrefix);
            }
          }
        }
        continue;
      }

      if (!ts.isCallExpression(el)) continue;

      const callee = el.expression;
      const fnName = ts.isIdentifier(callee) ? callee.text : "";

      if (fnName === "route" && el.arguments.length >= 2) {
        // route(path, file, children?)
        const pathArg = el.arguments[0];
        const fileArg = el.arguments[1];
        if (!ts.isStringLiteral(pathArg) || !ts.isStringLiteral(fileArg)) continue;

        let pattern = pathArg.text;
        if (prefixPath) {
          pattern = prefixPath + "/" + pattern;
        }
        if (!pattern.startsWith("/")) {
          pattern = "/" + pattern;
        }

        const filePath = resolveFilePath(fileArg.text);
        modules.push({
          file: filePath,
          routePattern: pattern,
          exports: [],
          parentLayout,
          isLayout: false,
          isIndex: false,
        });

        // Process children if present — children nest under this route
        if (el.arguments.length >= 3) {
          const childrenArg = el.arguments[2];
          if (ts.isArrayLiteralExpression(childrenArg)) {
            processElements(childrenArg.elements, filePath, prefixPath);
          }
        }
      } else if (fnName === "index" && el.arguments.length >= 1) {
        // index(file)
        const fileArg = el.arguments[0];
        if (!ts.isStringLiteral(fileArg)) continue;

        let pattern = "/";
        if (prefixPath) {
          pattern = "/" + prefixPath;
        }

        const filePath = resolveFilePath(fileArg.text);
        modules.push({
          file: filePath,
          routePattern: pattern,
          exports: [],
          parentLayout,
          isLayout: false,
          isIndex: true,
        });
      } else if (fnName === "layout" && el.arguments.length >= 2) {
        // layout(file, children)
        const fileArg = el.arguments[0];
        const childrenArg = el.arguments[1];
        if (!ts.isStringLiteral(fileArg)) continue;

        const filePath = resolveFilePath(fileArg.text);
        modules.push({
          file: filePath,
          routePattern: null,
          exports: [],
          parentLayout,
          isLayout: true,
          isIndex: false,
        });

        if (ts.isArrayLiteralExpression(childrenArg)) {
          processElements(childrenArg.elements, filePath, prefixPath);
        }
      }
      // Skip unrecognized call expressions
    }
  }

  processElements(defaultExpr.elements, null, null);

  return modules;
}

// ── findRoutesDir ───────────────────────────────────────────────────────────

export function findRoutesDir(targetDir: string, files: string[]): string | null {
  // Check common conventions
  const candidates = [
    "app/routes",
    "src/routes",
    "routes",
  ];

  for (const candidate of candidates) {
    const full = join(targetDir, candidate);
    if (existsSync(full)) {
      return candidate;
    }
  }

  // Fallback: look for files that match route patterns
  // Skip paths under test/fixture directories — those are test fixtures, not app routes
  const testSegments = new Set(["test", "tests", "fixtures", "__tests__", "__fixtures__"]);
  for (const file of files) {
    const parts = file.split("/");
    const routesIdx = parts.indexOf("routes");
    if (routesIdx >= 0) {
      const pathBeforeRoutes = parts.slice(0, routesIdx);
      if (pathBeforeRoutes.some(seg => testSegments.has(seg))) continue;
      return parts.slice(0, routesIdx + 1).join("/");
    }
  }

  return null;
}
