/**
 * Docroot detection (`php-docroots.ts`), `.htaccess` reading
 * (`php-htaccess.ts`) and the docroot routes over hand-made captures
 * (`php-docroot.ts`); no grammar needed.
 */

import { describe, expect, it } from "vitest";
import type { Capture, PackSourceFile } from "@n-dx/lang-runtime";
import { DOCROOT_QUERY, parseHtaccess, phpDocroots, primaryDocroot, readDocrootRoutes } from "../../src/index.js";

describe("phpDocroots", () => {
  it("finds a docroot directory per application, at any depth, sorted", () => {
    expect(phpDocroots(["apps/b/public/index.php", "apps/a/web/index.php", "index.php", "lib/x.php"])).toEqual(["apps/a/web", "apps/b/public"]);
  });

  it("leaves out a docroot inside another, and a docroot-named directory without index.php", () => {
    expect(phpDocroots(["public/index.php", "public/www/index.php", "htdocs/page.php"])).toEqual(["public"]);
  });

  it("falls back to the repository root holding index.php, else none", () => {
    expect(phpDocroots(["index.php", "admin/index.php"])).toEqual([""]);
    expect(phpDocroots(["lib/a.php"])).toEqual([]);
  });

  it("keeps include resolution's single top-level docroot", () => {
    expect(primaryDocroot(new Set(["web/index.php", "public/index.php"]))).toBe("public");
    expect(primaryDocroot(new Set(["apps/a/public/index.php"]))).toBe("");
  });
});

describe("parseHtaccess", () => {
  it("reads directory denial over a grant, and a grant alone", () => {
    expect(parseHtaccess("a/.htaccess", "Order deny,allow\nDENY FROM ALL\nAllow from all\n").access).toEqual({ denied: true, line: 2 });
    expect(parseHtaccess("a/.htaccess", "<IfModule mod_authz_core.c>\n  Require all granted\n</IfModule>\n").access).toEqual({ denied: false, line: 2 });
    expect(parseHtaccess("a/.htaccess", "Options -Indexes\n").access).toBeUndefined();
  });

  it("reads Require ip, host and local as a restriction, which a grant or denial in the same file overrides", () => {
    expect(parseHtaccess("a/.htaccess", "Require ip 127.0.0.1 ::1\nRequire host example.org\n").access).toEqual({
      denied: false,
      line: 1,
      restriction: "Require ip 127.0.0.1 ::1",
    });
    expect(parseHtaccess("a/.htaccess", "Require local\n").access).toEqual({ denied: false, line: 1, restriction: "Require local" });
    expect(parseHtaccess("a/.htaccess", "Require ip 10.0.0.0/8\nRequire all granted\n").access).toEqual({ denied: false, line: 2 });
    expect(parseHtaccess("a/.htaccess", "Require ip 10.0.0.0/8\nRequire all denied\n").access).toEqual({ denied: true, line: 2 });
    // `Require not` only narrows inside <RequireAll>; a bare `Require ip` with no address names no client.
    expect(parseHtaccess("a/.htaccess", "Require not ip 10.0.0.1\nRequire ip\n").access).toBeUndefined();
    // Not read inside <Files>, nor for methods other than GET and POST.
    expect(parseHtaccess("a/.htaccess", "<Files admin.php>\nRequire ip 10.0.0.1\n</Files>\n").access).toBeUndefined();
    expect(parseHtaccess("a/.htaccess", "<LimitExcept GET POST>\nRequire local\n</LimitExcept>\n").access).toBeUndefined();
  });

  it("applies a <Limit>/<LimitExcept> rule only when the block covers GET or POST", () => {
    expect(parseHtaccess(".htaccess", "<LimitExcept GET POST>\n  Deny from all\n</LimitExcept>\n").access).toBeUndefined();
    expect(parseHtaccess(".htaccess", "<Limit PUT DELETE>\n  Require all denied\n</Limit>\n").access).toBeUndefined();
    expect(parseHtaccess(".htaccess", "<Limit GET POST>\n  Deny from all\n</Limit>\n").access).toEqual({ denied: true, line: 2 });
    expect(parseHtaccess(".htaccess", "<LimitExcept OPTIONS>\n  Require all denied\n</LimitExcept>\n").access).toEqual({ denied: true, line: 2 });
  });

  it("scopes a denial inside <Files> and <FilesMatch> to the names they match", () => {
    const h = parseHtaccess(".htaccess", '<Files "*.ini">\nDeny from all\n</Files>\n<FilesMatch "\\.(bak|sql)$">\nRequire all denied\n</FilesMatch>\n');
    expect(h.access).toBeUndefined();
    const names = ["db.ini", "dump.sql", "a.bak", "index.php", "sub.ini.php"];
    expect(names.filter((n) => h.fileDenials.some((d) => d.matches(n)))).toEqual(["db.ini", "dump.sql", "a.bak"]);
  });

  it("reads RedirectMatch 403 and names a pattern it cannot read", () => {
    const h = parseHtaccess("x/.htaccess", "RedirectMatch 403 ^/secret/\nRedirectMatch 403 (\nRedirectMatch 301 ^/old /new\n");
    expect(h.urlDenials.map((d) => d.pattern.source)).toEqual(["^\\/secret\\/"]);
    expect(h.notices).toEqual(["x/.htaccess:2 RedirectMatch 403 pattern ( could not be read; it is not applied."]);
  });

  it("reads rewrites to a literal .php target, not redirects, proxies, back-references or other files", () => {
    const h = parseHtaccess(
      ".htaccess",
      [
        "RewriteEngine On",
        "RewriteBase /shop/",
        "RewriteRule ^(.*)$ index.php?q=$1 [L,QSA]",
        "RewriteRule ^old$ /new.php [R=301,L]",
        "RewriteRule ^api/(.*)$ http://backend/$1.php [P]",
        "RewriteRule ^(\\w+)$ $1.php [L]",
        "RewriteRule ^img/ - [F]",
        "RewriteRule ^feed$ \\",
        "  /feed.php [L]",
        "FallbackResource disabled",
        "FallbackResource /front.php",
      ].join("\n"),
    );
    expect(h.rewriteBase).toBe("/shop/");
    expect(h.frontControllers).toEqual([
      { directive: "RewriteRule", pattern: "^(.*)$", target: "index.php", line: 3 },
      { directive: "RewriteRule", pattern: "^feed$", target: "/feed.php", line: 8 },
      { directive: "FallbackResource", target: "/front.php", line: 11 },
    ]);
  });
});

/** A parsed file whose top-level statements are `types`. */
const file = (path: string, ...types: string[]): PackSourceFile => ({
  path,
  captures: {
    [DOCROOT_QUERY]: types.map((nodeType): Capture => ({ name: "docroot.top", nodeType, text: "", start: { line: 1, column: 0 }, end: { line: 1, column: 0 } })),
  },
});

describe("readDocrootRoutes", () => {
  const page = (path: string) => file(path, "php_tag", "echo_statement");

  it("routes each docroot of a repository with several applications", () => {
    const { facts } = readDocrootRoutes([page("a/public/index.php"), page("b/web/index.php"), page("b/web/x/y.php"), page("a/src/lib.php")], new Map());
    expect([...facts].map(([path, f]) => `${path} ${f.routes!.map((r) => `${r.method} ${r.path} ${r.source}`).join(", ")}`)).toEqual([
      "a/public/index.php GET /index.php docroot a/public, POST /index.php docroot a/public",
      "b/web/index.php GET /index.php docroot b/web, POST /index.php docroot b/web",
      "b/web/x/y.php GET /x/y.php docroot b/web, POST /x/y.php docroot b/web",
    ]);
  });

  it("puts a relative rewrite target under RewriteBase, and names a target that is not a repository file", () => {
    const htaccess = new Map([
      ["public/shop/.htaccess", "RewriteBase /shop/\nRewriteRule ^(.*)$ main.php [L]\n"],
      ["public/blog/.htaccess", "RewriteRule ^(.*)$ app.php [L]\n"],
    ]);
    const { facts, notices } = readDocrootRoutes(
      [page("public/index.php"), file("public/shop/main.php", "php_tag", "function_definition"), page("public/shop/cart.php")],
      htaccess,
    );
    expect(facts.get("public/shop/main.php")?.routes?.map((r) => `${r.method} ${r.path} ${r.source}`)).toEqual([
      "GET ^(.*)$ public/shop/.htaccess:2",
      "POST ^(.*)$ public/shop/.htaccess:2",
    ]);
    expect(notices).toEqual([
      "PHP: public/blog/.htaccess:1 RewriteRule sends requests to app.php, which is not a PHP file of the repository; no route recorded.",
    ]);
  });

  it("treats blank inline text as a declaration and visible text as a page", () => {
    const blank: PackSourceFile = {
      path: "lib.php",
      captures: { [DOCROOT_QUERY]: [{ name: "docroot.top", nodeType: "text_interpolation", text: "?>\n", start: { line: 1, column: 0 }, end: { line: 2, column: 0 } }] },
    };
    const visible: PackSourceFile = {
      path: "page.php",
      captures: { [DOCROOT_QUERY]: [{ name: "docroot.top", nodeType: "text", text: "<p>hi</p>", start: { line: 1, column: 0 }, end: { line: 1, column: 9 } }] },
    };
    expect([...readDocrootRoutes([page("index.php"), blank, visible], new Map()).facts.keys()]).toEqual(["index.php", "page.php"]);
  });
});
