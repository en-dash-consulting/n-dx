/**
 * Docroot routes over the PHP pack: legacy PHP has no route table, so the
 * URLs a site serves are its files under the document root and the
 * front controllers its `.htaccess` files rewrite to.
 *
 * A framework pack (lang-runtime's `FrameworkPack`): its query
 * (`queries/php-docroot/docroot.scm`) runs in the PHP parse only when routes
 * are wanted. `.htaccess` text comes from the resolver's `configFiles`
 * (read beside the sources by `phpResolver.forProject`). Rules (keys of
 * {@link PROVENANCE}):
 *
 * - `docroots`: `php-docroots.ts`'s `phpDocroots` — each `public/`, `web/`,
 *   `htdocs/`, `www/` or `public_html/` holding an `index.php`, at any depth
 *   and not inside another, else the repository root holding `index.php`.
 * - `docroot-files`: each `.php` or `.phtml` file under a docroot is a
 *   `GET` and a `POST` route at its path from the docroot (`/admin/users.php`),
 *   handled by that file, with `source` `docroot <dir>` (`.` for the root).
 *   Left out: a file named `*.inc.php`, a file whose top-level statements are
 *   all declarations (function, class, interface, trait, enum, namespace,
 *   `use`, `const`, `declare`, comments; blank inline text), which is an
 *   included fragment, and a file `.htaccess` denies (`php-htaccess.ts`).
 * - `htaccess-access`: a directory's nearest `.htaccess` at or below the
 *   docroot setting directory access decides it; `<Files>`/`<FilesMatch>`
 *   denials and `RedirectMatch 403` in any `.htaccess` above the file apply too.
 * - `htaccess-rewrite`, `fallback-resource`: a `RewriteRule` or
 *   `FallbackResource` front controller in an `.htaccess` under a docroot is
 *   a catch-all `GET` and `POST` route handled by its target file: the
 *   rule's pattern as written, or `<directory URL>*` for `FallbackResource`,
 *   with `source` `<.htaccess path>:<line>`. A target that is not a pack file
 *   is a notice.
 *
 * Positions are the handler file's start: the routes are not declared in it.
 *
 * @module lang-php/php-docroot
 */

import { join } from "node:path";
import type { FactKind, FileFacts, RouteFact } from "@n-dx/lang-kit";
import type { FrameworkContext, FrameworkFacts, FrameworkPack, PackSourceFile, RuleProvenance } from "@n-dx/lang-runtime";
import { PHP_PACKAGE } from "./package-paths.js";
import { dirOf, isWithin, phpDocroots } from "./php-docroots.js";
import { parseHtaccess, type Htaccess } from "./php-htaccess.js";

export const DOCROOT_QUERY = "docroot";

const apache = (path: string): string => `https://httpd.apache.org/docs/2.4/mod/${path}`;
const rule = (verifiedAgainst: readonly string[], source: string): RuleProvenance => ({ verifiedAgainst, verifiedOn: "2026-11-16", source });

const PROVENANCE: Readonly<Record<string, RuleProvenance>> = {
  [DOCROOT_QUERY]: rule(["tree-sitter-php@0.25.1"], "https://github.com/tree-sitter/tree-sitter-php/blob/v0.25.1/php/src/node-types.json"),
  // The server maps a URL path to the file at that path under DocumentRoot.
  docroots: rule(["Apache HTTP Server 2.4"], apache("core.html#documentroot")),
  "docroot-files": rule(["Apache HTTP Server 2.4"], "https://httpd.apache.org/docs/2.4/urlmapping.html"),
  // Require all denied (mod_authz_core), Deny from all (mod_access_compat), <Files>/<FilesMatch>, RedirectMatch 403 (mod_alias).
  "htaccess-access": rule(["Apache HTTP Server 2.4"], apache("mod_authz_core.html#require")),
  // RewriteRule in per-directory context: the pattern matches the path below the directory; a relative substitution is under RewriteBase.
  "htaccess-rewrite": rule(["Apache HTTP Server 2.4"], apache("mod_rewrite.html#rewriterule")),
  // FallbackResource: the URL served for a request that maps to no file.
  "fallback-resource": rule(["Apache HTTP Server 2.4"], apache("mod_dir.html#fallbackresource")),
};

/** Top-level nodes that only declare: a file of nothing else runs no code when requested. */
const DECLARATIONS: ReadonlySet<string> = new Set([
  "php_tag",
  "comment",
  "function_definition",
  "class_declaration",
  "interface_declaration",
  "trait_declaration",
  "enum_declaration",
  "namespace_definition",
  "namespace_use_declaration",
  "const_declaration",
  "declare_statement",
  "empty_statement",
]);

/** Inline text outside `<?php … ?>` that outputs nothing visible: whitespace, around the tags. */
const isBlankText = (text: string): boolean => text.replace(/\?>|<\?(php)?/gi, "").trim() === "";

/** A file whose every top-level statement only declares: an included fragment. */
function isFragment(file: PackSourceFile): boolean {
  return (file.captures[DOCROOT_QUERY] ?? []).every(
    (c) => DECLARATIONS.has(c.nodeType) || ((c.nodeType === "text" || c.nodeType === "text_interpolation") && isBlankText(c.text)),
  );
}

const isPage = (path: string): boolean => /\.(php|phtml)$/i.test(path) && !/\.inc\.php$/i.test(path);

const START = { line: 1, column: 0 } as const;

/** `path`'s URL under `docroot`: `/` and the path below it. */
const urlOf = (path: string, docroot: string): string => `/${docroot === "" ? path : path.slice(docroot.length + 1)}`;

/** One docroot's `.htaccess` files, nearest-last lookup by directory. */
class DocrootAccess {
  constructor(
    private readonly docroot: string,
    private readonly byDir: ReadonlyMap<string, Htaccess>,
  ) {}

  /** The `.htaccess` files from the docroot down to `dir`, outermost first. */
  private chain(dir: string): Htaccess[] {
    const out: Htaccess[] = [];
    for (let d = dir; ; d = dirOf(d)) {
      const h = this.byDir.get(d);
      if (h) out.unshift(h);
      if (d === this.docroot || d === "") break;
    }
    return out;
  }

  /** Whether a request for `path` (at `url`) is refused. */
  denied(path: string, url: string): boolean {
    const chain = this.chain(dirOf(path));
    const name = path.slice(path.lastIndexOf("/") + 1);
    const nearest = [...chain].reverse().find((h) => h.access !== undefined);
    if (nearest?.access?.denied) return true;
    return chain.some((h) => h.fileDenials.some((d) => d.matches(name)) || h.urlDenials.some((d) => d.pattern.test(url)));
  }
}

/** Every docroot's routes and what was skipped. */
export function readDocrootRoutes(files: readonly PackSourceFile[], htaccessText: ReadonlyMap<string, string>): FrameworkFacts {
  const paths = new Set(files.map((f) => f.path));
  const routes = new Map<string, RouteFact[]>();
  const notices: string[] = [];
  const add = (path: string, url: string, source: string): void => {
    const list = routes.get(path) ?? [];
    for (const method of ["GET", "POST"]) list.push({ method, path: url, source, position: START });
    routes.set(path, list);
  };

  for (const docroot of phpDocroots(paths)) {
    const byDir = new Map<string, Htaccess>();
    for (const [file, text] of [...htaccessText].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (!isWithin(dirOf(file), docroot)) continue;
      const parsed = parseHtaccess(file, text);
      byDir.set(dirOf(file), parsed);
      notices.push(...parsed.notices);
    }
    const access = new DocrootAccess(docroot, byDir);
    const source = `docroot ${docroot === "" ? "." : docroot}`;
    for (const file of files) {
      if (!isWithin(file.path, docroot) || !isPage(file.path) || isFragment(file)) continue;
      const url = urlOf(file.path, docroot);
      if (!access.denied(file.path, url)) add(file.path, url, source);
    }
    for (const [dir, htaccess] of byDir) {
      const dirUrl = dir === docroot ? "/" : `${urlOf(dir, docroot)}/`;
      for (const fc of htaccess.frontControllers) {
        const base = htaccess.rewriteBase ?? dirUrl;
        const targetUrl = fc.target.startsWith("/") ? fc.target : `${base.endsWith("/") ? base : `${base}/`}${fc.target}`;
        const handler = [docroot, targetUrl.slice(1)].filter((p) => p !== "").join("/");
        const at = `${htaccess.file}:${fc.line}`;
        if (!paths.has(handler)) {
          notices.push(`${at} ${fc.directive} sends requests to ${fc.target}, which is not a PHP file of the repository; no route recorded.`);
          continue;
        }
        add(handler, fc.pattern ?? `${dirUrl}*`, at);
      }
    }
  }
  const facts = new Map<string, Omit<FileFacts, "path">>([...routes].map(([path, list]) => [path, { routes: list }]));
  return { facts, notices: notices.map((n) => `PHP: ${n}`) };
}

export const phpDocroot: FrameworkPack = {
  id: "php-docroot",
  produces: ["routes"],
  // A getter, so the path is computed on first use rather than at import.
  get queries() {
    return [{ name: DOCROOT_QUERY, path: join(PHP_PACKAGE.queryDir("php-docroot"), `${DOCROOT_QUERY}.scm`) }];
  },
  provenance: PROVENANCE,
  read(files: readonly PackSourceFile[], kinds: readonly FactKind[], context?: FrameworkContext): FrameworkFacts {
    return kinds.includes("routes") ? readDocrootRoutes(files, context?.configFiles?.() ?? new Map()) : { facts: new Map(), notices: [] };
  },
};
