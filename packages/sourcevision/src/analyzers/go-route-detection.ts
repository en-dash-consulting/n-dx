/**
 * Go server-side HTTP route detection.
 *
 * Regex-based extraction of route registrations from popular Go frameworks:
 * 1. net/http stdlib: http.HandleFunc, http.Handle, mux.HandleFunc
 * 2. chi: r.Get, r.Post, r.Put, r.Delete, r.Patch, r.Route, r.Group
 * 3. gin: router.GET, router.POST, router.PUT, router.DELETE, router.PATCH
 * 4. echo: e.GET, e.POST, e.PUT, e.DELETE, e.PATCH
 * 5. fiber: app.Get, app.Post, app.Put, app.Delete, app.Patch
 * 6. gorilla/mux: r.HandleFunc("/path").Methods("GET")
 */

import type { HttpMethod, ServerRoute, ServerRouteGroup } from "../schema/index.js";

const VALID_METHODS = new Set<string>(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);

// ── Comment stripping ───────────────────────────────────────────────────────

/**
 * Strip Go comments from source text to prevent false positives.
 * Removes:
 * - Line comments: // ...
 * - Block comments: /* ... * /
 * Preserves string literals (double-quoted and backtick-quoted).
 */
function stripGoComments(source: string): string {
  const result: string[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    // Double-quoted string literal — preserve as-is
    if (ch === '"') {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === '\\') {
          j += 2; // skip escaped character
        } else if (source[j] === '"') {
          j++;
          break;
        } else {
          j++;
        }
      }
      result.push(source.slice(i, j));
      i = j;
      continue;
    }

    // Raw string literal (backtick) — preserve as-is
    if (ch === '`') {
      const end = source.indexOf('`', i + 1);
      if (end === -1) {
        result.push(source.slice(i));
        break;
      }
      result.push(source.slice(i, end + 1));
      i = end + 1;
      continue;
    }

    // Line comment — replace with newline to preserve line structure
    if (ch === '/' && i + 1 < source.length && source[i + 1] === '/') {
      const eol = source.indexOf('\n', i);
      if (eol === -1) {
        break;
      }
      result.push('\n');
      i = eol + 1;
      continue;
    }

    // Block comment — replace with space to preserve separation
    if (ch === '/' && i + 1 < source.length && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) {
        break;
      }
      result.push(' ');
      i = end + 2;
      continue;
    }

    result.push(ch);
    i++;
  }

  return result.join('');
}

// ── Route extraction patterns ───────────────────────────────────────────────

/**
 * net/http stdlib patterns:
 *   http.HandleFunc("/path", handler)
 *   http.Handle("/path", handler)
 *   mux.HandleFunc("/path", handler)
 *   mux.Handle("/path", handler)
 *
 * These always register as ALL methods (no method filter), so we record as GET
 * since that's the most common use, but the handler accepts any method.
 */
const STDLIB_HANDLE_RE =
  /\b(?:http|mux|serveMux|server)\s*\.\s*(?:HandleFunc|Handle)\s*\(\s*"(\/[^"]*)"(?:\s*,|\s*\))/gi;

/**
 * chi method patterns (lowercase method names):
 *   r.Get("/path", handler)
 *   r.Post("/path", handler)
 *   r.Put("/path", handler)
 *   r.Delete("/path", handler)
 *   r.Patch("/path", handler)
 *   r.Options("/path", handler)
 *   r.Head("/path", handler)
 */
const CHI_METHOD_RE =
  /\b\w+\s*\.\s*(Get|Post|Put|Delete|Patch|Options|Head)\s*\(\s*"(\/[^"]*)"\s*,/g;

/**
 * gin method patterns (uppercase method names):
 *   router.GET("/path", handler)
 *   router.POST("/path", handler)
 *   etc.
 */
const GIN_METHOD_RE =
  /\b\w+\s*\.\s*(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\s*\(\s*"(\/[^"]*)"\s*,/g;

/**
 * echo method patterns (uppercase method names, same syntax as gin):
 *   e.GET("/path", handler)
 *   e.POST("/path", handler)
 * Note: echo uses the same uppercase pattern as gin, so this regex covers both.
 * We separate them for clarity — the GIN_METHOD_RE handles these too.
 */

/**
 * fiber method patterns (mixed-case):
 *   app.Get("/path", handler)
 *   app.Post("/path", handler)
 *   These look identical to chi syntactically, so CHI_METHOD_RE covers them.
 */

/**
 * gorilla/mux HandleFunc().Methods() chain:
 *   r.HandleFunc("/path").Methods("GET")
 *   r.HandleFunc("/path").Methods("GET", "POST")
 */
const GORILLA_CHAIN_RE =
  /\b\w+\s*\.\s*HandleFunc\s*\(\s*"(\/[^"]*)"\s*(?:,\s*[^)]+)?\)\s*\.\s*Methods\s*\(\s*"([A-Z]+)"(?:\s*,\s*"([A-Z]+)")*\s*\)/g;

/**
 * gorilla/mux alternate: Methods chained before HandleFunc or via Path
 *   r.Methods("GET").Path("/path").HandlerFunc(handler)
 */
const GORILLA_METHODS_PATH_RE =
  /\b\w+\s*\.\s*Methods\s*\(\s*"([A-Z]+)"(?:\s*,\s*"([A-Z]+)")*\s*\)\s*\.\s*Path\s*\(\s*"(\/[^"]*)"\s*\)/g;

// ── Main detection function ─────────────────────────────────────────────────

/**
 * Detect HTTP route registrations from Go source code.
 *
 * Covers six framework patterns:
 * 1. net/http stdlib (HandleFunc, Handle)
 * 2. chi (Get, Post, Put, Delete, Patch)
 * 3. gin (GET, POST, PUT, DELETE, PATCH)
 * 4. echo (GET, POST, PUT, DELETE, PATCH — same syntax as gin)
 * 5. fiber (Get, Post, Put, Delete, Patch — same syntax as chi)
 * 6. gorilla/mux (HandleFunc().Methods() chain)
 *
 * Path parameters are preserved as-is: "/users/{id}", "/users/:id"
 */
export function detectGoServerRoutes(sourceText: string, filePath: string): ServerRouteGroup[] {
  const cleaned = stripGoComments(sourceText);
  const routes: ServerRoute[] = [];
  const seen = new Set<string>();

  function addRoute(method: string, path: string): void {
    const upper = method.toUpperCase();
    if (!VALID_METHODS.has(upper)) return;
    const key = `${upper} ${path}`;
    if (seen.has(key)) return;
    seen.add(key);
    routes.push({ file: filePath, method: upper as HttpMethod, path });
  }

  // 1. net/http stdlib — HandleFunc/Handle (method-agnostic, record as GET)
  {
    let match: RegExpExecArray | null;
    STDLIB_HANDLE_RE.lastIndex = 0;
    while ((match = STDLIB_HANDLE_RE.exec(cleaned)) !== null) {
      addRoute("GET", match[1]);
    }
  }

  // 2+5. chi / fiber — mixed-case method names: r.Get, app.Post, etc.
  {
    let match: RegExpExecArray | null;
    CHI_METHOD_RE.lastIndex = 0;
    while ((match = CHI_METHOD_RE.exec(cleaned)) !== null) {
      addRoute(match[1], match[2]);
    }
  }

  // 3+4. gin / echo — uppercase method names: router.GET, e.POST, etc.
  {
    let match: RegExpExecArray | null;
    GIN_METHOD_RE.lastIndex = 0;
    while ((match = GIN_METHOD_RE.exec(cleaned)) !== null) {
      addRoute(match[1], match[2]);
    }
  }

  // 6a. gorilla/mux — HandleFunc("/path").Methods("GET")
  {
    let match: RegExpExecArray | null;
    GORILLA_CHAIN_RE.lastIndex = 0;
    while ((match = GORILLA_CHAIN_RE.exec(cleaned)) !== null) {
      const path = match[1];
      // First method is always captured
      addRoute(match[2], path);
      // Additional methods captured in group 3+ (regex only captures last)
      // Re-parse the Methods() call to capture all methods
      const methodsStr = match[0];
      const methodsMatch = methodsStr.match(/\.Methods\s*\(([^)]+)\)/);
      if (methodsMatch) {
        const methodArgs = methodsMatch[1];
        const methodRe = /"([A-Z]+)"/g;
        let m: RegExpExecArray | null;
        while ((m = methodRe.exec(methodArgs)) !== null) {
          addRoute(m[1], path);
        }
      }
    }
  }

  // 6b. gorilla/mux — Methods("GET").Path("/path")
  {
    let match: RegExpExecArray | null;
    GORILLA_METHODS_PATH_RE.lastIndex = 0;
    while ((match = GORILLA_METHODS_PATH_RE.exec(cleaned)) !== null) {
      const path = match[3];
      // Re-parse Methods() to capture all methods
      const methodsStr = match[0];
      const methodsMatch = methodsStr.match(/\.Methods\s*\(([^)]+)\)/);
      if (methodsMatch) {
        const methodArgs = methodsMatch[1];
        const methodRe = /"([A-Z]+)"/g;
        let m: RegExpExecArray | null;
        while ((m = methodRe.exec(methodArgs)) !== null) {
          addRoute(m[1], path);
        }
      }
    }
  }

  if (routes.length === 0) return [];

  // Sort routes by method then path
  routes.sort((a, b) => {
    const mc = a.method.localeCompare(b.method);
    return mc !== 0 ? mc : a.path.localeCompare(b.path);
  });

  // Infer a common prefix
  const prefix = inferPrefix(routes);

  return [
    {
      file: filePath,
      prefix,
      routes,
    },
  ];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Infer a common prefix from a set of routes. */
function inferPrefix(routes: ServerRoute[]): string {
  if (routes.length === 0) return "/";
  if (routes.length === 1) {
    const onlyPath = routes[0].path;
    if (onlyPath.endsWith("/")) return onlyPath;
    const lastSlash = onlyPath.lastIndexOf("/");
    return lastSlash > 0 ? onlyPath.slice(0, lastSlash + 1) : "/";
  }

  const paths = routes.map((r) => r.path);
  let prefix = paths[0];
  for (let i = 1; i < paths.length; i++) {
    while (!paths[i].startsWith(prefix)) {
      const trimEnd = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
      const lastSlash = trimEnd.lastIndexOf("/");
      if (lastSlash <= 0) return "/";
      prefix = trimEnd.slice(0, lastSlash + 1);
    }
  }
  // Ensure prefix ends with /
  if (!prefix.endsWith("/")) {
    const lastSlash = prefix.lastIndexOf("/");
    prefix = lastSlash > 0 ? prefix.slice(0, lastSlash + 1) : "/";
  }
  return prefix;
}
