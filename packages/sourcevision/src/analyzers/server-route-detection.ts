/**
 * Server-side API route detection.
 *
 * Detects HTTP route handlers from:
 * 1. JSDoc/comment annotations with "METHOD /path" patterns
 * 2. Express/Hono/Koa-style method calls: app.get("/path", handler)
 * 3. Manual routing patterns: if (method === "GET" && path === "...")
 * 4. Go HTTP framework patterns (net/http, chi, gin, echo, fiber, gorilla/mux)
 */

import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import ts from "typescript";
import type {
  HttpMethod,
  ServerRoute,
  ServerRouteGroup,
  Inventory,
  Classifications,
} from "../schema/index.js";
import { buildClassificationMap } from "./classify.js";
import { detectGoServerRoutes } from "./go-route-detection.js";

const VALID_METHODS = new Set<string>(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);
const PARSEABLE = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".go"]);

// HTTP method names used in framework-style chaining: app.get(), router.post(), etc.
const FRAMEWORK_METHOD_NAMES = new Set(["get", "post", "put", "patch", "delete", "options", "head"]);

// ── JSDoc extraction ────────────────────────────────────────────────────────

/**
 * Extract routes from JSDoc/block comments matching patterns like:
 *   GET   /api/rex/prd           — description
 *   POST  /api/rex/items         — description
 *   PATCH /api/rex/items/:id     — description
 */
const JSDOC_ROUTE_RE =
  /^\s*\*?\s*(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(\/\S+)/gm;

export function extractRoutesFromComments(sourceText: string, filePath: string): ServerRoute[] {
  const routes: ServerRoute[] = [];
  const seen = new Set<string>();

  // Match block comments (/** ... */ or /* ... */)
  const blockCommentRe = /\/\*[\s\S]*?\*\//g;
  let match: RegExpExecArray | null;

  while ((match = blockCommentRe.exec(sourceText)) !== null) {
    const comment = match[0];
    let routeMatch: RegExpExecArray | null;
    JSDOC_ROUTE_RE.lastIndex = 0;

    while ((routeMatch = JSDOC_ROUTE_RE.exec(comment)) !== null) {
      const method = routeMatch[1] as HttpMethod;
      // Strip trailing description markers (em-dash/en-dash preceded by space)
      // but NOT hyphens within path segments (e.g., smart-add-preview)
      const path = routeMatch[2].replace(/\s+[—–].*$/, "").trim();
      const key = `${method} ${path}`;
      if (!seen.has(key)) {
        seen.add(key);
        routes.push({ file: filePath, method, path });
      }
    }
  }

  return routes;
}

// ── Framework pattern detection (Express/Hono/Koa) ──────────────────────────

/**
 * Detect routes from framework-style method calls:
 *   app.get("/path", handler)
 *   router.post("/path", handler)
 *   app.route("/prefix", subRouter)
 */
export function extractRoutesFromFrameworkCalls(
  sourceText: string,
  filePath: string,
): ServerRoute[] {
  const sf = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    extname(filePath) === ".tsx" || extname(filePath) === ".jsx"
      ? ts.ScriptKind.TSX
      : extname(filePath) === ".ts"
        ? ts.ScriptKind.TS
        : ts.ScriptKind.JS,
  );

  const routes: ServerRoute[] = [];
  const seen = new Set<string>();

  function visit(node: ts.Node) {
    // app.get("/path", handler) or router.post("/path", handler)
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.name) &&
      FRAMEWORK_METHOD_NAMES.has(node.expression.name.text) &&
      node.arguments.length >= 1
    ) {
      const methodName = node.expression.name.text.toUpperCase();
      if (VALID_METHODS.has(methodName)) {
        const firstArg = node.arguments[0];
        // Only accept string literals starting with "/" — excludes
        // URLSearchParams.get("key"), Map.get("key"), etc.
        if (ts.isStringLiteral(firstArg) && firstArg.text.startsWith("/")) {
          const path = firstArg.text;
          const key = `${methodName} ${path}`;
          if (!seen.has(key)) {
            seen.add(key);
            routes.push({ file: filePath, method: methodName as HttpMethod, path });
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
  return routes;
}

// ── Prefix detection ────────────────────────────────────────────────────────

/**
 * Try to detect a route prefix from the file, looking for patterns like:
 *   const PREFIX = "/api/rex/"
 *   const REX_PREFIX = "/api/rex/"
 */
export function detectRoutePrefix(sourceText: string): string | null {
  const prefixRe = /(?:const|let)\s+\w*(?:PREFIX|prefix|Prefix)\w*\s*=\s*["'](\/[^"']+)["']/;
  const match = sourceText.match(prefixRe);
  return match ? match[1] : null;
}

/**
 * Try to detect the exported handler function name.
 *   export function handleRexRoute(...)
 *   export function rexRoutes(...)
 *   export default function(...)
 */
export function detectHandlerName(sourceText: string): string | null {
  const handlerRe = /export\s+(?:async\s+)?function\s+(handle\w+Route\w*|\w+Routes?\w*)\s*\(/;
  const match = sourceText.match(handlerRe);
  return match ? match[1] : null;
}

// ── Main detection ──────────────────────────────────────────────────────────

/**
 * Heuristic: should we scan this file for server routes?
 * Checks filename patterns and file content indicators.
 */
function isLikelyRouteFile(filePath: string, role: string, archetypeMap?: Map<string, string | null>): boolean {
  if (role === "test" || role === "config" || role === "docs") return false;
  // Check archetype classification first
  if (archetypeMap?.size) {
    const archetype = archetypeMap.get(filePath);
    if (archetype === "route-handler") return true;
  }
  const lower = filePath.toLowerCase();

  // Go files: main.go, router.go, routes.go, handler files, cmd/ or api/ directories
  if (lower.endsWith(".go")) {
    if (/_test\.go$/.test(lower)) return false;
    if (/(?:^|\/)(?:main|router|routes?)\.go$/.test(lower)) return true;
    if (/(?:^|\/)(?:cmd|api|handler|handlers|route|routes|server)\//.test(lower)) return true;
    return false;
  }

  // File named routes-*.ts or routes/*.ts or router.ts
  if (/(?:^|\/)routes?[-./]/.test(lower)) return true;
  if (/(?:^|\/)router\.[tj]sx?$/.test(lower)) return true;
  // File in a "routes" or "api" directory
  if (/(?:^|\/)(?:routes|api)\//.test(lower)) return true;
  return false;
}

/**
 * Detect server-side API routes across the project.
 * Returns route groups (one per file that defines routes).
 */
export async function detectServerRoutes(
  targetDir: string,
  inventory: Inventory,
  classifications?: Classifications | null,
): Promise<ServerRouteGroup[]> {
  const groups: ServerRouteGroup[] = [];
  const archetypeMap = buildClassificationMap(classifications);

  // Find candidate files
  const candidates = inventory.files.filter((f) => {
    const ext = extname(f.path).toLowerCase();
    return PARSEABLE.has(ext) && isLikelyRouteFile(f.path, f.role, archetypeMap);
  });

  for (const file of candidates) {
    const fullPath = join(targetDir, file.path);
    let sourceText: string;
    try {
      sourceText = await readFile(fullPath, "utf-8");
    } catch {
      continue;
    }

    const ext = extname(file.path).toLowerCase();

    // Dispatch Go files to the dedicated Go detector
    if (ext === ".go") {
      const goGroups = detectGoServerRoutes(sourceText, file.path);
      groups.push(...goGroups);
      continue;
    }

    // JS/TS path: JSDoc extraction + framework pattern detection
    // Try JSDoc extraction first (most reliable for well-documented APIs)
    let routes = extractRoutesFromComments(sourceText, file.path);

    // Also try framework pattern detection
    const frameworkRoutes = extractRoutesFromFrameworkCalls(sourceText, file.path);

    // Merge: JSDoc routes are authoritative, framework routes fill gaps
    const seen = new Set(routes.map(r => `${r.method} ${r.path}`));
    for (const fr of frameworkRoutes) {
      const key = `${fr.method} ${fr.path}`;
      if (!seen.has(key)) {
        routes.push(fr);
        seen.add(key);
      }
    }

    if (routes.length === 0) continue;

    const prefix = detectRoutePrefix(sourceText) ?? inferPrefix(routes);
    const handler = detectHandlerName(sourceText) ?? undefined;

    groups.push({
      file: file.path,
      prefix,
      handler,
      routes: routes.sort((a, b) => {
        const mc = a.method.localeCompare(b.method);
        return mc !== 0 ? mc : a.path.localeCompare(b.path);
      }),
    });
  }

  return groups.sort((a, b) => a.file.localeCompare(b.file));
}

/** Infer a common prefix from a set of routes. */
function inferPrefix(routes: ServerRoute[]): string {
  if (routes.length === 0) return "/";
  const paths = routes.map(r => r.path);
  // Find longest common prefix
  let prefix = paths[0];
  for (let i = 1; i < paths.length; i++) {
    while (!paths[i].startsWith(prefix)) {
      const lastSlash = prefix.lastIndexOf("/");
      if (lastSlash <= 0) return "/";
      prefix = prefix.slice(0, lastSlash + 1);
    }
  }
  // Ensure prefix ends with /
  if (!prefix.endsWith("/")) {
    const lastSlash = prefix.lastIndexOf("/");
    prefix = lastSlash > 0 ? prefix.slice(0, lastSlash + 1) : "/";
  }
  return prefix;
}
