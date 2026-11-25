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
  it("reads directory denial over a grant under Order allow,deny, and a grant alone", () => {
    expect(parseHtaccess("a/.htaccess", "Order allow,deny\nAllow from all\nDENY FROM ALL\n").access).toEqual({ denied: true, line: 3 });
    // Under deny,allow (also the default) an Allow overrides a Deny.
    expect(parseHtaccess("a/.htaccess", "Order deny,allow\nDENY FROM ALL\nAllow from all\n").access).toEqual({ denied: false, line: 3 });
    expect(parseHtaccess("a/.htaccess", "<IfModule mod_authz_core.c>\n  Require all granted\n</IfModule>\n").access).toEqual({ denied: false, line: 2 });
    expect(parseHtaccess("a/.htaccess", "Options -Indexes\n").access).toBeUndefined();
  });

  it("reads Require ip, host and local as a restriction, which a grant in the same file overrides and a sibling denial does not", () => {
    expect(parseHtaccess("a/.htaccess", "Require ip 127.0.0.1 ::1\nRequire host example.org\n").access).toEqual({
      denied: false,
      line: 1,
      restriction: "Require ip 127.0.0.1 ::1",
    });
    expect(parseHtaccess("a/.htaccess", "Require local\n").access).toEqual({ denied: false, line: 1, restriction: "Require local" });
    expect(parseHtaccess("a/.htaccess", "Require ip 10.0.0.0/8\nRequire all granted\n").access).toEqual({ denied: false, line: 2 });
    // Sibling Require lines are <RequireAny>: the named clients are served.
    expect(parseHtaccess("a/.htaccess", "Require ip 10.0.0.0/8\nRequire all denied\n").access).toEqual({
      denied: false,
      line: 1,
      restriction: "Require ip 10.0.0.0/8",
    });
    // `Require not` only narrows inside <RequireAll>; a bare `Require ip` with no address names no client.
    expect(parseHtaccess("a/.htaccess", "Require not ip 10.0.0.1\nRequire ip\n").access).toBeUndefined();
    // Not read inside <Files>, nor for methods other than GET and POST.
    expect(parseHtaccess("a/.htaccess", "<Files admin.php>\nRequire ip 10.0.0.1\n</Files>\n").access).toBeUndefined();
    expect(parseHtaccess("a/.htaccess", "<LimitExcept GET POST>\nRequire local\n</LimitExcept>\n").access).toBeUndefined();
  });

  it("reads Apache 2.2's Allow from <clients> by Order, and joins it with Require as Satisfy All", () => {
    // deny,allow: the Allow overrides Deny from all for the clients it names.
    expect(parseHtaccess("a/.htaccess", "Order deny,allow\nDeny from all\nAllow from 10.0.0.0/8\n").access).toEqual({
      denied: false,
      line: 3,
      restriction: "Allow from 10.0.0.0/8",
    });
    // deny,allow is the default Order.
    expect(parseHtaccess("a/.htaccess", "Deny from all\nAllow from 10.0.0.1\n").access).toEqual({ denied: false, line: 2, restriction: "Allow from 10.0.0.1" });
    // allow,deny: Deny from all overrides every Allow.
    expect(parseHtaccess("a/.htaccess", "Order allow,deny\nDeny from all\nAllow from 10.0.0.0/8\n").access).toEqual({ denied: true, line: 2 });
    expect(parseHtaccess("a/.htaccess", "Order Allow,Deny\nAllow from 10.0.0.0/8\n").access).toEqual({ denied: false, line: 2, restriction: "Allow from 10.0.0.0/8" });
    // Allow from <clients> under deny,allow with no denial serves everyone.
    expect(parseHtaccess("a/.htaccess", "Allow from 10.0.0.0/8\n").access).toBeUndefined();
    // The dual-version idiom: each half restricts, so the directory is restricted once, at its first line.
    const dual = [
      "<IfModule mod_authz_core.c>",
      "  Require ip 10.0.0.0/8",
      "</IfModule>",
      "<IfModule !mod_authz_core.c>",
      "  Order deny,allow",
      "  Deny from all",
      "  Allow from 10.0.0.0/8",
      "</IfModule>",
    ].join("\n");
    expect(parseHtaccess("admin/.htaccess", dual).access).toEqual({ denied: false, line: 2, restriction: "Require ip 10.0.0.0/8" });
    // Mixed without <IfModule>, a client must pass both: a denial in either wins.
    expect(parseHtaccess("a/.htaccess", "Require all granted\nDeny from all\n").access).toEqual({ denied: true, line: 2 });
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
    expect(h.notices).toEqual([".htaccess:6 RewriteRule target $1.php takes its PHP file from the request; no route recorded."]);
  });

  it("reads a CodeIgniter-style front controller with path info or a query-string path, and notices a back-reference in the file", () => {
    const h = parseHtaccess(
      "web/.htaccess",
      ["RewriteRule ^(.*)$ index.php/$1 [L]", "RewriteRule ^(.*)$ index.php?/$1 [L]", "RewriteRule ^p/(\\w+)$ pages/$1.php/x [L]"].join("\n"),
    );
    expect(h.frontControllers).toEqual([
      { directive: "RewriteRule", pattern: "^(.*)$", target: "index.php", line: 1 },
      { directive: "RewriteRule", pattern: "^(.*)$", target: "index.php", line: 2 },
    ]);
    expect(h.notices).toEqual(["web/.htaccess:3 RewriteRule target pages/$1.php/x takes its PHP file from the request; no route recorded."]);
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

  it("keeps pages an Apache 2.2 or dual-version allow-list restricts, with one notice, and drops them under Order allow,deny", () => {
    const dual = "<IfModule mod_authz_core.c>\nRequire ip 10.0.0.0/8\n</IfModule>\n<IfModule !mod_authz_core.c>\nOrder deny,allow\nDeny from all\nAllow from 10.0.0.0/8\n</IfModule>\n";
    const htaccess = new Map([
      ["admin/.htaccess", dual],
      ["ops/.htaccess", "Order deny,allow\nDeny from all\nAllow from 10.0.0.0/8\n"],
      ["mixed/.htaccess", "Require ip 10.0.0.0/8\nRequire all denied\n"],
      ["closed/.htaccess", "Order allow,deny\nDeny from all\nAllow from 10.0.0.0/8\n"],
    ]);
    const pages = ["index.php", "admin/a.php", "ops/b.php", "mixed/c.php", "closed/d.php"].map(page);
    const { facts, notices } = readDocrootRoutes(pages, htaccess);
    expect([...facts.keys()]).toEqual(["index.php", "admin/a.php", "ops/b.php", "mixed/c.php"]);
    expect(notices).toEqual([
      "PHP: admin/.htaccess:2 Require ip 10.0.0.0/8 serves admin/ only to the clients it names; its 1 file stays a route.",
      "PHP: mixed/.htaccess:1 Require ip 10.0.0.0/8 serves mixed/ only to the clients it names; its 1 file stays a route.",
      "PHP: ops/.htaccess:3 Allow from 10.0.0.0/8 serves ops/ only to the clients it names; its 1 file stays a route.",
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
