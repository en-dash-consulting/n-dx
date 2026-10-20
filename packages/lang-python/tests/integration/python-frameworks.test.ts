/**
 * The FastAPI, Flask and Django framework packs over their fixture projects
 * (`tests/fixtures/<framework>`): the routes a hand check would look for,
 * the notices, and how the pack entry runs the frameworks only when routes
 * are wanted and gives them the resolver. The whole output is pinned by the
 * goldens in `pack-golden.test.ts`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FactKind, FileFacts, RouteFact } from "@n-dx/lang-kit";
import {
  createPackEntry,
  createTreeSitterRunner,
  factGaps,
  listFixtureFiles,
  skipUnlessGrammar,
  type FrameworkContext,
  type FrameworkPack,
} from "@n-dx/lang-runtime";

import { DJANGO_QUERY, django } from "../../src/django.js";
import { fastapi } from "../../src/fastapi.js";
import { flask } from "../../src/flask.js";
import { PYTHON_PACKAGE } from "../../src/package-paths.js";
import { pack } from "../../src/pack.js";
import { pythonGrammarPath, pythonPack } from "../../src/python-pack.js";
import { PYTHON_SYMBOL_RULES } from "../../src/python-symbols.js";
import { PACK_FIXTURE_ROOT } from "../helpers/pack-fixtures.js";

type Ctx = Parameters<typeof skipUnlessGrammar>[0];

const fixture = (name: string): string => join(PACK_FIXTURE_ROOT, "..", name);

async function analyze(ctx: Ctx, projectDir: string, kinds: readonly FactKind[] = ["routes"]) {
  skipUnlessGrammar(ctx, pythonGrammarPath());
  return pack.analyzeProject({ projectDir, files: listFixtureFiles(projectDir, [".py"]), kinds });
}

const route = (r: RouteFact): string => `${r.method ?? "ANY"} ${r.path} ${r.handler ?? "-"}`;
const routesOf = (facts: readonly FileFacts[], file: string): string[] | undefined => facts.find((f) => f.path === file)?.routes?.map(route);

describe("FastAPI routes", () => {
  it("reads every decorator, follows include_router across files and keeps a prefix that is not a literal", async (ctx) => {
    const { facts, notices } = await analyze(ctx, fixture("fastapi"));
    expect(routesOf(facts, "app/api/routes/items.py")).toEqual([
      "GET ${settings.API_V1_STR}/items/ read_items",
      "POST ${settings.API_V1_STR}/items/ create_item",
      "PUT ${settings.API_V1_STR}/items/{id} update_item",
      "DELETE ${settings.API_V1_STR}/items/{id} delete_item",
      "PATCH ${settings.API_V1_STR}/items/{id} patch_item",
      "OPTIONS ${settings.API_V1_STR}/items/ item_options",
      "HEAD ${settings.API_V1_STR}/items/ item_head",
      "PUT ${settings.API_V1_STR}/items/bulk bulk",
      "POST ${settings.API_V1_STR}/items/bulk bulk",
      "GET ${settings.API_V1_STR}/items/any any_item",
      "GET ${settings.API_V1_STR}/items/${VERSION}/latest latest",
    ]);
    // An aliased module import, and a decorator on a name that is no router.
    expect(routesOf(facts, "app/api/routes/users.py")).toEqual(["GET ${settings.API_V1_STR}/people/me me"]);
    // A relative, aliased router import mounted twice.
    expect(routesOf(facts, "app/api/routes/admin.py")).toEqual([
      "GET ${settings.API_V1_STR}/admin/tools/stats stats",
      "GET ${settings.API_V1_STR}/staff/tools/stats stats",
    ]);
    expect(routesOf(facts, "app/legacy.py")).toEqual(["GET /legacy/ping ping"]);
    expect(routesOf(facts, "app/main.py")).toEqual(["GET /health health"]);
    expect(routesOf(facts, "app/core/config.py")).toEqual([]);
    expect(notices).toEqual([
      "FastAPI: 2 route paths or prefixes are not literals and are kept as written in ${…} form: " +
        'app/api/routes/items.py:58 (path f"/{VERSION}/latest"), app/main.py:9 (prefix settings.API_V1_STR).',
      "FastAPI: 1 route method is not a literal and was skipped: app/api/routes/items.py:53 (methods ALLOWED).",
      "FastAPI: 1 mount names no application or router the rules can follow and was not followed: app/main.py:10 (include_router make_router()).",
    ]);
  });

  it("places a route at its decorator's call", async (ctx) => {
    const { facts } = await analyze(ctx, fixture("fastapi"));
    const health = facts.find((f) => f.path === "app/main.py")?.routes?.[0];
    expect(health).toEqual({ method: "GET", path: "/health", handler: "health", position: { line: 15, column: 1 } });
  });
});

describe("Flask routes", () => {
  it("defaults to GET, reads Flask 2 shortcuts and follows register_blueprint across files", async (ctx) => {
    const { facts, notices } = await analyze(ctx, fixture("flask"));
    expect(routesOf(facts, "shop/__init__.py")).toEqual(["GET / index"]);
    expect(routesOf(facts, "shop/views.py")).toEqual([
      "GET /about about",
      "GET /login login",
      "POST /login login",
      "GET /feed feed",
      "GET /items/<int:id> item",
      "POST /items add_item",
      "PUT /items/<int:id> put_item",
      "DELETE /items/<int:id> delete_item",
      "PATCH /items/<int:id> patch_item",
      'GET ${PREFIX + "/redirect"} old_redirect',
    ]);
    // A nested blueprint gets its parent's prefix, then its own.
    expect(routesOf(facts, "shop/admin.py")).toEqual(["GET /admin/ dashboard", "GET /admin/reports/daily daily", "DELETE /admin/reports/daily daily"]);
    // The registration's url_prefix replaces the blueprint's.
    expect(routesOf(facts, "shop/api.py")).toEqual(["GET /api/v2/status status"]);
    expect(notices).toEqual([
      'Flask: 1 route path or prefix is not a literal and is kept as written in ${…} form: shop/views.py:47 (path PREFIX + "/redirect").',
      "Flask: 1 mount names no application or router the rules can follow and was not followed: shop/__init__.py:14 (register_blueprint missing_bp).",
    ]);
  });
});

describe("Django routes", () => {
  it("walks from ROOT_URLCONF through includes by string, module, list and tuple", async (ctx) => {
    const { facts, notices } = await analyze(ctx, fixture("django"));
    expect(routesOf(facts, "mysite/urls.py")).toEqual([
      "ANY / home",
      "ANY /inline/one/ one",
      "ANY /inline/^two/(?P<n>\\d+)/$ two",
      "ANY /sites/ SiteListView",
    ]);
    // Included three times; the regex is kept as written.
    expect(routesOf(facts, "blog/urls.py")).toEqual([
      "ANY ${settings.DYNAMIC_PREFIX} index",
      "ANY /archive/ index",
      "ANY /blog/ index",
      "ANY ${settings.DYNAMIC_PREFIX}/<int:year>/ year_archive",
      "ANY /archive/<int:year>/ year_archive",
      "ANY /blog/<int:year>/ year_archive",
      "ANY ${settings.DYNAMIC_PREFIX}/^(?P<slug>[\\w-]+)/$ post_detail",
      "ANY /archive/^(?P<slug>[\\w-]+)/$ post_detail",
      "ANY /blog/^(?P<slug>[\\w-]+)/$ post_detail",
    ]);
    // A view that is a call other than as_view(), or a lambda, has no handler.
    expect(routesOf(facts, "shop/urls.py")).toEqual(["ANY /shop/cart/ CartView", "ANY /shop/checkout/ -", "ANY /shop/ping/ -"]);
    expect(routesOf(facts, "mysite/extra.py")).toEqual(["ANY /extra/faq/ faq"]);
    // Not reached from ROOT_URLCONF.
    expect(routesOf(facts, "oldapp/urls.py")).toEqual([]);
    expect(notices).toEqual([
      "Django: 1 route path or prefix is not a literal and is kept as written in ${…} form: mysite/urls.py:21 (prefix settings.DYNAMIC_PREFIX).",
      "Django: 2 include() targets are not ones the rules can follow and were not followed: " +
        "mysite/urls.py:17 (include admin.site.urls), mysite/urls.py:32 (include somewhere.urls).",
      // device_router is defined in routers.py: its registrations in devices.py
      // count, and include(device_router.urls) in urls.py is left out like router.urls.
      "Django: 4 Django REST framework router registrations are counted, not expanded: " +
        "mysite/devices.py:13 (register device_router.register), mysite/devices.py:14 (register routers.device_router.register), " +
        "mysite/urls.py:12 (register router.register), mysite/urls.py:13 (register router.register).",
    ]);
  });

  it("captures sequences only where URL patterns can be, so a data table costs nothing", async (ctx) => {
    skipUnlessGrammar(ctx, pythonGrammarPath());
    const source = [
      'urlpatterns = [path("a/", views.a), url("^old/$", views.old)] + [re_path("^b/$", views.b)]', // 1
      'urlpatterns += [path("c/", include([path("d/", views.d)]))]', // 2
      'urlpatterns += [path("e/", include(("app.urls", "app"), namespace="app"))]', // 3
      'extra = [path("f/", views.f)]', // 4
      'TABLE = [("a", 0, [0, 1]), ("b", 1, [1, 2])]', // 5
      'NAMES = ["x", "y"]', // 6
      "PAIR = (1, 2)", // 7
      "configure([f(1)], (2, 3))", // 8
      "urlpatterns = format_suffix_patterns(urlpatterns, allowed=urlpatterns) + urlpatterns", // 9
      "total = len(other) + count - urlpatterns", // 10
      'urlpatterns = [*urlpatterns, path("g/", views.g)]', // 11
      "merged = [*extra, *urlpatterns]", // 12
      "call(*urlpatterns)", // 13
      "",
    ].join("\n");
    const runner = createTreeSitterRunner();
    try {
      const target = { pack: { ...pythonPack, queries: [...pythonPack.queries, ...django.queries] }, grammarPath: pythonGrammarPath() };
      const result = await runner.parseSource(target, "urls.py", source);
      if (result.status !== "parsed") throw new Error(`not parsed: ${result.status}`);
      const at = (name: string): string[] =>
        [...new Set((result.captures[DJANGO_QUERY] ?? []).filter((c) => c.name === name).map((c) => `${c.start.line}:${c.text}`))].sort();
      expect(at("django.sequence")).toEqual([
        '11:[*urlpatterns, path("g/", views.g)]',
        '1:[path("a/", views.a), url("^old/$", views.old)]',
        '1:[re_path("^b/$", views.b)]',
        '2:[path("c/", include([path("d/", views.d)]))]',
        '2:[path("d/", views.d)]',
        '3:("app.urls", "app")',
        '3:[path("e/", include(("app.urls", "app"), namespace="app"))]',
        '4:[path("f/", views.f)]',
      ]);
      // A list's entries are its path()/re_path() calls; an include() tuple's are all of them.
      expect(at("django.item")).toEqual([
        '11:path("g/", views.g)',
        '1:path("a/", views.a)',
        '1:re_path("^b/$", views.b)',
        '2:path("c/", include([path("d/", views.d)]))',
        '2:path("d/", views.d)',
        '3:"app"',
        '3:"app.urls"',
        '3:path("e/", include(("app.urls", "app"), namespace="app"))',
        '4:path("f/", views.f)',
      ]);
      expect(at("django.target")).toEqual(["11:urlpatterns", "1:urlpatterns", "2:urlpatterns", "3:urlpatterns", "4:extra", "9:urlpatterns"]);
      // `urlpatterns` only, and only as a `+` operand, a call's argument or unpacked in a list.
      expect((result.captures[DJANGO_QUERY] ?? []).filter((c) => c.name === "django.self").map((c) => `${c.start.line}:${c.start.column}`)).toEqual([
        "9:37",
        "9:58",
        "9:73",
        "11:16",
        "12:19",
      ]);
      expect(at("django.splat")).toEqual(["11:*urlpatterns", "12:*urlpatterns"]);
    } finally {
      runner.dispose();
    }
  });

  describe("without ROOT_URLCONF", () => {
    let dir: string;
    const write = (path: string, text: string): void => {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    };
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "lang-python-django-"));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it("starts at each URLconf no other includes", async (ctx) => {
      write("site/urls.py", 'urlpatterns = [path("api/", include("api.urls"))]\n');
      write("api/urls.py", 'urlpatterns = [path("items/", views.items)]\n');
      write("tools/urls.py", 'urlpatterns = [path("tools/", views.tools)]\n');
      // A literal that names no parsed module is no root.
      write("site/settings.py", 'ROOT_URLCONF = "elsewhere.urls"\n');
      const { facts } = await analyze(ctx, dir);
      expect(routesOf(facts, "api/urls.py")).toEqual(["ANY /api/items/ items"]);
      expect(routesOf(facts, "tools/urls.py")).toEqual(["ANY /tools/ tools"]);
    });
  });

  describe("a urlpatterns reassignment", () => {
    let dir: string;
    const urls = (...lines: string[]): void => {
      writeFileSync(join(dir, "urls.py"), ['from django.urls import path', 'urlpatterns = [path("a/", views.a), path("b/", views.b)]', ...lines, ""].join("\n"));
    };
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "lang-python-django-reassign-"));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it("through format_suffix_patterns(urlpatterns) keeps the earlier patterns", async (ctx) => {
      urls("urlpatterns = format_suffix_patterns(urlpatterns)");
      const { facts, notices } = await analyze(ctx, dir);
      expect(routesOf(facts, "urls.py")).toEqual(["ANY /a/ a", "ANY /b/ b"]);
      expect(notices).toBeUndefined();
    });

    it("to urlpatterns + static(…) keeps the earlier patterns", async (ctx) => {
      urls("urlpatterns = urlpatterns + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)");
      const { facts, notices } = await analyze(ctx, dir);
      expect(routesOf(facts, "urls.py")).toEqual(["ANY /a/ a", "ANY /b/ b"]);
      expect(notices).toBeUndefined();
    });

    it("to urlpatterns + [path(…)] keeps the earlier patterns and appends the new ones", async (ctx) => {
      urls('urlpatterns = urlpatterns + [path("c/", views.c)]', 'urlpatterns = [path("d/", views.d)] + urlpatterns');
      const { facts } = await analyze(ctx, dir);
      expect(routesOf(facts, "urls.py")).toEqual(["ANY /a/ a", "ANY /b/ b", "ANY /c/ c", "ANY /d/ d"]);
    });

    it("to a list unpacking *urlpatterns keeps the earlier patterns where they are unpacked", async (ctx) => {
      urls('urlpatterns = [*urlpatterns, path("c/", views.c)]', 'urlpatterns = [path("d/", views.d), *urlpatterns]');
      const { facts, notices } = await analyze(ctx, dir);
      expect(routesOf(facts, "urls.py")).toEqual(["ANY /a/ a", "ANY /b/ b", "ANY /c/ c", "ANY /d/ d"]);
      expect(notices).toBeUndefined();
    });

    it("to a list whose inner include() list unpacks *urlpatterns replaces the earlier patterns", async (ctx) => {
      urls('urlpatterns = [path("c/", views.c), path("x/", include([*urlpatterns, path("y/", views.y)]))]');
      writeFileSync(join(dir, "settings.py"), 'ROOT_URLCONF = "urls"\n');
      const { facts } = await analyze(ctx, dir);
      expect(routesOf(facts, "urls.py")).toEqual(["ANY /c/ c", "ANY /x/y/ y"]);
    });

    it("to a list whose call argument unpacks *urlpatterns, with no path() beside it, replaces the earlier patterns", async (ctx) => {
      urls('urlpatterns = [path("c/", views.c), path("x/", include([*urlpatterns]))]');
      writeFileSync(join(dir, "settings.py"), 'ROOT_URLCONF = "urls"\n');
      const { facts } = await analyze(ctx, dir);
      expect(routesOf(facts, "urls.py")).toEqual(["ANY /c/ c"]);
    });

    it("to a new list replaces the earlier patterns", async (ctx) => {
      urls('urlpatterns = [path("c/", views.c), path("again/", include(urlpatterns))]');
      // A file that includes itself is no root without ROOT_URLCONF.
      writeFileSync(join(dir, "settings.py"), 'ROOT_URLCONF = "urls"\n');
      const { facts, notices } = await analyze(ctx, dir);
      expect(routesOf(facts, "urls.py")).toEqual(["ANY /c/ c"]);
      // `urlpatterns` inside the new list does not make it build on the old one.
      expect(notices).toBeUndefined();
    });

    it("that leaves no patterns where there were some is counted", async (ctx) => {
      urls('urlpatterns = i18n_patterns(path("c/", views.c))');
      const { facts, notices } = await analyze(ctx, dir);
      expect(routesOf(facts, "urls.py")).toEqual([]);
      expect(notices).toEqual([
        "Django: 1 urlpatterns assignment drops the patterns set before it and adds none the rules can read: " +
          'urls.py:3 (urlpatterns = i18n_patterns(path("c/", views.c))).',
      ]);
    });
  });
});

describe("an imported name rebound at module level", () => {
  let dir: string;
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lang-python-rebound-"));
    write("app/__init__.py", "");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("is not followed through its import when the rebinding comes after it", async (ctx) => {
    write("app/routers.py", "from rest_framework.routers import DefaultRouter\nrouter = DefaultRouter()\n");
    write("app/after.py", 'from .routers import router\nrouter = make_other()\nrouter.register("a", AView)\n');
    // The import overrides an assignment before it; a function's own binding is not module level.
    write("app/before.py", 'router = make_other()\nfrom .routers import router\nrouter.register("b", BView)\n');
    write("app/nested.py", 'from .routers import router\ndef f():\n    router = make_other()\nrouter.register("c", CView)\n');
    // An annotation alone binds nothing, and a method is no module-level binding.
    write("app/annotated.py", 'from .routers import router\nrouter: Router\nclass K:\n    def router(self): ...\nrouter.register("d", DView)\n');
    const { notices } = await analyze(ctx, dir);
    expect(notices).toEqual([
      "Django: 3 Django REST framework router registrations are counted, not expanded: " +
        "app/annotated.py:5 (register router.register), app/before.py:3 (register router.register), app/nested.py:4 (register router.register).",
    ]);
  });

  it("does not mount a FastAPI router or a Flask blueprint through a rebound name", async (ctx) => {
    write("app/items.py", 'from fastapi import APIRouter\nrouter = APIRouter()\n@router.get("/items")\ndef items(): ...\n');
    write("app/main.py", 'from fastapi import FastAPI\nfrom .items import router\nrouter = make_other()\napp = FastAPI()\napp.include_router(router, prefix="/api")\n');
    write("app/views.py", 'from flask import Blueprint\nbp = Blueprint("v", __name__)\n@bp.route("/views")\ndef views(): ...\n');
    write("app/site.py", 'from flask import Flask\nfrom .views import bp\nclass bp: ...\nsite = Flask(__name__)\nsite.register_blueprint(bp, url_prefix="/site")\n');
    write("app/early.py", 'from fastapi import FastAPI\ndef router(): ...\nfrom .items import router\nearly = FastAPI()\nearly.include_router(router, prefix="/early")\n');
    const { facts, notices } = await analyze(ctx, dir);
    expect(routesOf(facts, "app/items.py")).toEqual(["GET /early/items items"]);
    expect(routesOf(facts, "app/views.py")).toEqual(["GET /views views"]);
    expect(notices).toEqual([
      "FastAPI: 1 mount names no application or router the rules can follow and was not followed: app/main.py:5 (include_router router).",
      "Flask: 1 mount names no application or router the rules can follow and was not followed: app/site.py:5 (register_blueprint bp).",
    ]);
  });
});

describe("a name an Object.prototype member has", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lang-python-prototype-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("is no route decorator and no application constructor", async (ctx) => {
    writeFileSync(
      join(dir, "main.py"),
      [
        "from fastapi import FastAPI",
        "from flask import Flask",
        "app = FastAPI()",
        "web = Flask(__name__)",
        "fake = toString()",
        "other = constructor()",
        '@app.constructor("/a")',
        "def a(): ...",
        '@web.toString("/b")',
        "def b(): ...",
        '@app.__proto__("/c")',
        "def c(): ...",
        '@fake.get("/d")',
        "def d(): ...",
        '@other.route("/e")',
        "def e(): ...",
        "",
      ].join("\n"),
    );
    const { facts } = await analyze(ctx, dir);
    expect(routesOf(facts, "main.py")).toEqual([]);
  });
});

describe("a name a package's __init__.py re-exports from its submodule of the same name", () => {
  let dir: string;
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lang-python-reexport-"));
    write("app/__init__.py", "");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("is followed to the FastAPI router it names, so the mount prefix applies", async (ctx) => {
    write("app/api/router.py", 'from fastapi import APIRouter\nrouter = APIRouter()\n@router.get("/x")\ndef x(): ...\n');
    write("app/api/__init__.py", "from .router import router\n");
    write("app/main.py", 'from fastapi import FastAPI\nfrom app.api import router\napp = FastAPI()\napp.include_router(router, prefix="/api")\n');
    const { facts, notices } = await analyze(ctx, dir);
    expect(routesOf(facts, "app/api/router.py")).toEqual(["GET /api/x x"]);
    expect(notices).toBeUndefined();
  });

  it("is followed to the Flask blueprint it names", async (ctx) => {
    write("app/views/bp.py", 'from flask import Blueprint\nbp = Blueprint("v", __name__)\n@bp.route("/x")\ndef x(): ...\n');
    write("app/views/__init__.py", "from .bp import bp\n");
    write("app/site.py", 'from flask import Flask\nfrom app.views import bp\nsite = Flask(__name__)\nsite.register_blueprint(bp, url_prefix="/site")\n');
    const { facts, notices } = await analyze(ctx, dir);
    expect(routesOf(facts, "app/views/bp.py")).toEqual(["GET /site/x x"]);
    expect(notices).toBeUndefined();
  });

  it("is followed to the Django REST framework router it names", async (ctx) => {
    write("app/api/router.py", "from rest_framework.routers import DefaultRouter\nrouter = DefaultRouter()\n");
    write("app/api/__init__.py", "from .router import router\n");
    write("app/urls.py", 'from app.api import router\nrouter.register("a", AView)\n');
    const { notices } = await analyze(ctx, dir);
    expect(notices).toEqual([
      "Django: 1 Django REST framework router registration is counted, not expanded: app/urls.py:2 (register router.register).",
    ]);
  });

  it("still names the submodule when __init__.py neither defines nor imports the name", async (ctx) => {
    write("app/api/router.py", 'from fastapi import APIRouter\nrouter = APIRouter()\n@router.get("/x")\ndef x(): ...\n');
    write("app/api/__init__.py", "from . import other\n");
    write("app/api/other.py", "");
    write("app/main.py", 'from fastapi import FastAPI\nfrom app.api import router\napp = FastAPI()\napp.include_router(router.router, prefix="/api")\n');
    // `from . import router` binds the submodule too: __init__.py's binding is a module, not a router.
    write("app/sub/router.py", 'from fastapi import APIRouter\nrouter = APIRouter()\n@router.get("/y")\ndef y(): ...\n');
    write("app/sub/__init__.py", "from . import router\n");
    write("app/sub_main.py", 'from fastapi import FastAPI\nfrom app.sub import router\nsub = FastAPI()\nsub.include_router(router, prefix="/sub")\n');
    const { facts, notices } = await analyze(ctx, dir);
    expect(routesOf(facts, "app/api/router.py")).toEqual(["GET /api/x x"]);
    expect(routesOf(facts, "app/sub/router.py")).toEqual(["GET /y y"]);
    expect(notices).toEqual([
      "FastAPI: 1 mount names no application or router the rules can follow and was not followed: app/sub_main.py:4 (include_router router).",
    ]);
  });
});

describe("a module a package's __init__.py re-exports under another name", () => {
  let dir: string;
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lang-python-module-reexport-"));
    write("app/__init__.py", "");
    write("app/api/v1/__init__.py", "");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("is followed as the base of a dotted FastAPI router, so the mount prefix applies", async (ctx) => {
    write("app/api/v1/routes.py", 'from fastapi import APIRouter\nrouter = APIRouter()\n@router.get("/x")\ndef x(): ...\n');
    write("app/api/__init__.py", "from .v1 import routes as endpoints\n");
    write("app/main.py", 'from fastapi import FastAPI\nfrom app.api import endpoints\napp = FastAPI()\napp.include_router(endpoints.router, prefix="/api")\n');
    const { facts, notices } = await analyze(ctx, dir);
    expect(routesOf(facts, "app/api/v1/routes.py")).toEqual(["GET /api/x x"]);
    expect(notices).toBeUndefined();
  });

  it("is followed through a chain of re-exports to a Django include()", async (ctx) => {
    write("app/api/v1/urls.py", 'from django.urls import path\nfrom . import views\nurlpatterns = [path("x/", views.x)]\n');
    write("app/api/v1/__init__.py", "from . import urls as v1_urls\n");
    write("app/api/__init__.py", "from .v1 import v1_urls as api_urls\n");
    write("app/urls.py", 'from django.urls import include, path\nfrom app.api import api_urls\nurlpatterns = [path("api/", include(api_urls))]\n');
    const { facts, notices } = await analyze(ctx, dir);
    expect(routesOf(facts, "app/api/v1/urls.py")).toEqual(["ANY /api/x/ x"]);
    expect(notices).toBeUndefined();
  });

  it("is not a module when __init__.py binds the name to an object", async (ctx) => {
    write("app/api/v1/routes.py", 'from fastapi import APIRouter\nrouter = APIRouter()\n@router.get("/x")\ndef x(): ...\n');
    // `endpoints` is the router object, so `endpoints.router` is not the submodule's router.
    write("app/api/endpoints.py", 'from fastapi import APIRouter\nrouter = APIRouter()\n@router.get("/y")\ndef y(): ...\n');
    write("app/api/__init__.py", "from .v1.routes import router as endpoints\n");
    write("app/main.py", 'from fastapi import FastAPI\nfrom app.api import endpoints\napp = FastAPI()\napp.include_router(endpoints.router, prefix="/api")\n');
    const { facts, notices } = await analyze(ctx, dir);
    expect(routesOf(facts, "app/api/endpoints.py")).toEqual(["GET /y y"]);
    expect(notices).toEqual([
      "FastAPI: 1 mount names no application or router the rules can follow and was not followed: app/main.py:4 (include_router endpoints.router).",
    ]);
  });

  it("still names the submodule when __init__.py imports the name only inside a function", async (ctx) => {
    write("app/api/endpoints.py", 'from fastapi import APIRouter\nrouter = APIRouter()\n@router.get("/y")\ndef y(): ...\n');
    write("app/api/legacy.py", 'from fastapi import APIRouter\nrouter = APIRouter()\n@router.get("/z")\ndef z(): ...\n');
    write("app/api/__init__.py", "def setup():\n    from . import legacy as endpoints\n    return endpoints\n");
    write("app/main.py", 'from fastapi import FastAPI\nfrom app.api import endpoints\napp = FastAPI()\napp.include_router(endpoints.router, prefix="/api")\n');
    const { facts, notices } = await analyze(ctx, dir);
    expect(routesOf(facts, "app/api/endpoints.py")).toEqual(["GET /api/y y"]);
    expect(routesOf(facts, "app/api/legacy.py")).toEqual(["GET /z z"]);
    expect(notices).toBeUndefined();
  });
});

describe("the Python pack entry with its frameworks", () => {
  it("lists routes and is consistent with its frameworks", () => {
    expect(pythonPack.produces).toContain("routes");
    expect(pythonPack.frameworks?.map((f) => f.id)).toEqual(["fastapi", "flask", "django", "python-clients"]);
    expect(factGaps(pythonPack, PYTHON_SYMBOL_RULES)).toEqual([]);
    for (const framework of pythonPack.frameworks ?? []) {
      for (const query of framework.queries) expect(framework.provenance[query.name], query.name).toBeDefined();
    }
  });

  it("runs the frameworks only when routes are wanted, with the resolver as their context", async (ctx) => {
    skipUnlessGrammar(ctx, pythonGrammarPath());
    const spy = (framework: FrameworkPack) => vi.fn(framework.read);
    const reads = [spy(fastapi), spy(flask), spy(django)];
    const entry = createPackEntry({
      package: PYTHON_PACKAGE,
      pack: { ...pythonPack, frameworks: [fastapi, flask, django].map((f, i) => ({ ...f, queries: f.queries, read: reads[i]! })) },
      symbolRules: PYTHON_SYMBOL_RULES,
    });
    const dir = fixture("fastapi");
    const files = listFixtureFiles(dir, [".py"]);

    const imports = await entry.analyzeProject({ projectDir: dir, files, kinds: ["imports"] });
    for (const read of reads) expect(read).not.toHaveBeenCalled();
    expect(imports.facts.every((f) => f.routes === undefined)).toBe(true);

    const routes = await entry.analyzeProject({ projectDir: dir, files, kinds: ["routes"] });
    for (const read of reads) expect(read).toHaveBeenCalledOnce();
    expect(routes.facts.every((f) => Array.isArray(f.routes) && f.imports === undefined)).toBe(true);
    const context = reads[0]!.mock.calls[0]![2] as FrameworkContext;
    expect(context.module?.("app/api/main.py", ".routes.admin")).toBe("app/api/routes/admin.py");
    expect(context.module?.("app/main.py", "app.api.routes.items")).toBe("app/api/routes/items.py");
    expect(context.module?.("app/main.py", "app.api")).toBe("app/api/__init__.py");
    expect(context.module?.("app/main.py", "fastapi")).toBeUndefined();
  });

  it("reports the resolver's own notices only when imports are wanted, even after a framework prepared it", async (ctx) => {
    skipUnlessGrammar(ctx, pythonGrammarPath());
    const dir = mkdtempSync(join(tmpdir(), "lang-python-notices-"));
    try {
      // Relative imports past the source root give a resolver notice; following `r` makes FastAPI prepare the resolver.
      writeFileSync(join(dir, "m.py"), "from fastapi import FastAPI\nfrom .x import r\n\napp = FastAPI()\napp.include_router(r)\n");
      let prepared = 0;
      const resolver = pythonPack.resolver!;
      const counting = {
        forProject: async (projectDir: string, files: readonly string[]) => {
          const bound = await resolver.forProject!(projectDir, files);
          return { prepare: (...args: Parameters<typeof bound.prepare>) => (prepared++, bound.prepare(...args)) };
        },
        prepare: resolver.prepare,
      };
      const entry = createPackEntry({ package: PYTHON_PACKAGE, pack: { ...pythonPack, resolver: counting }, symbolRules: PYTHON_SYMBOL_RULES });

      const withImports = await entry.analyzeProject({ projectDir: dir, files: ["m.py"], kinds: ["imports"] });
      expect(withImports.notices?.some((n) => n.includes("climbs past its source root"))).toBe(true);

      prepared = 0;
      const routesOnly = await entry.analyzeProject({ projectDir: dir, files: ["m.py"], kinds: ["routes"] });
      expect(prepared).toBe(1);
      expect(routesOnly.notices).toEqual([
        "FastAPI: 1 mount names no application or router the rules can follow and was not followed: m.py:5 (include_router r).",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
