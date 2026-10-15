/**
 * The Python resolver over small projects written to a temporary directory
 * and parsed with the Python grammar: what each import form resolves to.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createTreeSitterRunner, skipUnlessGrammar, type FileReferences, type PackSourceFile } from "@n-dx/lang-runtime";
import { pack } from "../../src/pack.js";
import { pythonGrammarPath, pythonPack } from "../../src/python-pack.js";
import { pythonResolver, type PreparedPythonResolver, type ImportOutcome } from "../../src/python-resolver.js";
import { PYTHON_STDLIB_MODULES } from "../../src/python-stdlib.js";

type Ctx = Parameters<typeof skipUnlessGrammar>[0];

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "py-resolver-"));
  dirs.push(dir);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const isPython = (path: string): boolean => /\.pyi?$/.test(path);

/** Parse the project's Python files and resolve them. */
async function resolve(ctx: Ctx, files: Record<string, string>): Promise<PreparedPythonResolver> {
  skipUnlessGrammar(ctx, pythonGrammarPath());
  const dir = project(files);
  const paths = Object.keys(files).filter(isPython).sort();
  const runner = createTreeSitterRunner();
  try {
    const parsed: PackSourceFile[] = [];
    for (const path of paths) {
      const result = await runner.parseFile({ pack: pythonPack, grammarPath: pythonGrammarPath() }, join(dir, path));
      if (result.status === "parsed") parsed.push({ path, captures: result.captures });
    }
    const bound = await pythonResolver.forProject!(dir, paths);
    return bound.prepare(parsed) as PreparedPythonResolver;
  } finally {
    runner.dispose();
  }
}

const targets = (refs: FileReferences): Record<string, readonly string[]> =>
  Object.fromEntries(refs.files.map((f) => [f.to, f.symbols]));

const externals = (refs: FileReferences) => refs.external.map((e) => ({ package: e.package, symbols: e.symbols, module: e.module }));

const outcomes = (prepared: PreparedPythonResolver, path: string): Record<string, ImportOutcome> =>
  Object.fromEntries(prepared.outcomes(path).map((r) => [r.written.specifier, r.outcome]));

describe("absolute imports", () => {
  it("resolve a package before a module, a module before a namespace package, and .py before a .pyi beside it", async (ctx) => {
    const r = await resolve(ctx, {
      "main.py": "import pkg\nimport pkg.mod\nimport pkg.stubbed\nimport pkg.stub_only\nimport ns.inner\nimport ns\n",
      "pkg/__init__.py": "",
      "pkg.py": "",
      "pkg/mod.py": "",
      "pkg/stubbed.py": "",
      "pkg/stubbed.pyi": "",
      "pkg/stub_only.pyi": "",
      "ns/inner.py": "",
    });
    expect(targets(r.resolve("main.py"))).toEqual({
      "ns/inner.py": ["*"],
      "pkg/__init__.py": ["*"],
      "pkg/mod.py": ["*"],
      "pkg/stub_only.pyi": ["*"],
      "pkg/stubbed.py": ["*"],
    });
    // A namespace package imported itself resolves to its directory and gives no edge.
    expect(outcomes(r, "main.py").ns).toEqual({ kind: "namespace", dir: "ns" });
  });

  it("from-imports target a submodule when one exists, otherwise the module with the name as symbol", async (ctx) => {
    const r = await resolve(ctx, {
      "app.py": "from pkg import sub, helper as h, Thing\nfrom pkg.sub import *\nfrom ns import part, missing\n",
      "pkg/__init__.py": "",
      "pkg/sub/__init__.py": "",
      "ns/part.py": "",
    });
    expect(targets(r.resolve("app.py"))).toEqual({
      "ns/part.py": ["*"],
      "pkg/__init__.py": ["Thing", "helper"],
      "pkg/sub/__init__.py": ["*"],
    });
  });

  it("is unresolved when the top-level module is the project's but the module is not", async (ctx) => {
    const r = await resolve(ctx, { "app.py": "import pkg.gone\n", "pkg/__init__.py": "" });
    expect(r.resolve("app.py").files).toEqual([]);
    expect(r.resolve("app.py").external).toEqual([]);
    expect(outcomes(r, "app.py")["pkg.gone"]).toEqual({ kind: "unresolved", reason: "internal-not-found" });
  });

  it("is external when the missing module lies below a namespace package another distribution can extend", async (ctx) => {
    const r = await resolve(ctx, {
      "app.py": "from ns.core.version import parse\nfrom ns.own import x\n",
      "ns/own.py": "",
    });
    expect(targets(r.resolve("app.py"))).toEqual({ "ns/own.py": ["x"] });
    expect(r.resolve("app.py").external.map((e) => [e.package, e.symbols])).toEqual([["ns", ["parse"]]]);
    expect(outcomes(r, "app.py")["ns.core.version"]).toEqual({ kind: "external", module: "ns" });
  });
});

describe("relative imports", () => {
  it("climb from the file's package; __init__.py is the package itself", async (ctx) => {
    const r = await resolve(ctx, {
      "app/__init__.py": "",
      "app/pkg/__init__.py": "from . import a\nfrom .a import X\n",
      "app/pkg/a.py": "from . import b\nfrom .. import other\nfrom ..other import Y\nfrom .sub.deep import Z\nfrom ... import top\n",
      "app/pkg/b.py": "",
      "app/pkg/sub/deep.py": "",
      "app/other/__init__.py": "",
    });
    expect(targets(r.resolve("app/pkg/__init__.py"))).toEqual({ "app/pkg/a.py": ["*", "X"] });
    expect(targets(r.resolve("app/pkg/a.py"))).toEqual({
      "app/other/__init__.py": ["*", "Y"],
      "app/pkg/b.py": ["*"],
      "app/pkg/sub/deep.py": ["Z"],
    });
    // `...` from app/pkg/a.py climbs to the repository root, which is no package.
    expect(outcomes(r, "app/pkg/a.py")["..."]).toEqual({ kind: "unresolved", reason: "past-root" });
  });

  it("resolve in a project that is also a package under an outer root", async (ctx) => {
    const r = await resolve(ctx, {
      "pyproject.toml": '[project]\nname = "app"\n',
      "script/__init__.py": "",
      "script/check/pyproject.toml": '[project]\nname = "check"\n',
      "script/check/__init__.py": "",
      "script/check/__main__.py": "from .models import Result\n",
      "script/check/models.py": "",
    });
    expect(targets(r.resolve("script/check/__main__.py"))).toEqual({ "script/check/models.py": ["Result"] });
  });

  it("past the source root are unresolved and named in a notice", async (ctx) => {
    const r = await resolve(ctx, {
      "pyproject.toml": '[project]\nname = "x"\n',
      "src/pkg/__init__.py": "",
      "src/pkg/a.py": "from ... import top\nfrom .missing import M\n",
    });
    expect(outcomes(r, "src/pkg/a.py")).toEqual({
      "...": { kind: "unresolved", reason: "past-root" },
      ".missing": { kind: "unresolved", reason: "relative-not-found" },
    });
    expect(r.notices!()).toEqual([
      "Python: 1 relative import climbs past its source root and is not resolved: src/pkg/a.py:1 (...).",
    ]);
  });
});

describe("source roots", () => {
  it("resolve a src layout through its project", async (ctx) => {
    const r = await resolve(ctx, {
      "pyproject.toml": '[project]\nname = "lib"\n',
      "src/lib/__init__.py": "",
      "src/lib/core.py": "",
      "tests/test_core.py": "from lib.core import run\nimport lib\n",
    });
    expect(targets(r.resolve("tests/test_core.py"))).toEqual({ "src/lib/__init__.py": ["*"], "src/lib/core.py": ["run"] });
  });

  it("resolve against the file's own project first, then the others", async (ctx) => {
    const r = await resolve(ctx, {
      "a/pyproject.toml": '[project]\nname = "a"\n',
      "a/common/__init__.py": "",
      "a/main.py": "import common\nimport shared\n",
      "b/pyproject.toml": '[project]\nname = "b"\n',
      "b/common/__init__.py": "",
      "b/shared.py": "",
      "b/main.py": "import common\n",
    });
    expect(targets(r.resolve("a/main.py"))).toEqual({ "a/common/__init__.py": ["*"], "b/shared.py": ["*"] });
    expect(targets(r.resolve("b/main.py"))).toEqual({ "b/common/__init__.py": ["*"] });
  });

  it("include the project directory after its declared roots, for a test tree imported as a package", async (ctx) => {
    const r = await resolve(ctx, {
      "pyproject.toml": '[project]\nname = "lib"\n',
      "src/lib/__init__.py": "",
      "tests/__init__.py": "",
      "tests/helpers.py": "",
      "tests/test_lib.py": "from tests.helpers import make\n",
    });
    expect(targets(r.resolve("tests/test_lib.py"))).toEqual({ "tests/helpers.py": ["make"] });
  });

  it("is the repository root when no project is declared", async (ctx) => {
    const r = await resolve(ctx, { "tools/run.py": "import lib.x\n", "lib/__init__.py": "", "lib/x.py": "" });
    expect(targets(r.resolve("tools/run.py"))).toEqual({ "lib/x.py": ["*"] });
  });
});

describe("externals", () => {
  it("are named by top-level module, stdlib apart, and matched to dependencies by PEP 503 name only", async (ctx) => {
    const r = await resolve(ctx, {
      "pyproject.toml": [
        "[project]",
        'name = "app"',
        'dependencies = ["Requests==2.32.0", "typing_extensions", "PyYAML", "zope.interface"]',
        "",
      ].join("\n"),
      "app.py": [
        "import os.path",
        "from collections import OrderedDict",
        "import requests.adapters",
        "from typing_extensions import Self",
        "import yaml",
        "from zope import interface",
        "import numpy",
        "",
      ].join("\n"),
    });
    expect(externals(r.resolve("app.py"))).toEqual([
      { package: "numpy", symbols: ["*"], module: undefined },
      { package: "requests", symbols: ["*"], module: { path: "requests", version: "==2.32.0" } },
      { package: "stdlib:collections", symbols: ["OrderedDict"], module: undefined },
      { package: "stdlib:os", symbols: ["*"], module: undefined },
      { package: "typing_extensions", symbols: ["Self"], module: { path: "typing-extensions" } },
      // `yaml` is not `PyYAML`, and `zope` is not `zope.interface`: never guessed.
      { package: "yaml", symbols: ["*"], module: undefined },
      { package: "zope", symbols: ["interface"], module: undefined },
    ]);
    expect(outcomes(r, "app.py")["typing_extensions"]).toEqual({ kind: "external", module: "typing_extensions", dependency: "typing-extensions" });
    expect(outcomes(r, "app.py")["os.path"]).toEqual({ kind: "stdlib", module: "os" });
  });

  it("win over a project directory that is only a namespace package of the same name", async (ctx) => {
    const r = await resolve(ctx, {
      "requirements.txt": "docker>=7\n",
      "app.py": "import logging\nimport docker\n",
      "logging/handlers.py": "",
      "docker/build.py": "",
    });
    expect(r.resolve("app.py").files).toEqual([]);
    expect(r.resolve("app.py").external.map((e) => e.package)).toEqual(["docker", "stdlib:logging"]);
  });

  it("lose to a regular project package of the same name", async (ctx) => {
    const r = await resolve(ctx, { "app.py": "import logging\n", "logging/__init__.py": "" });
    expect(targets(r.resolve("app.py"))).toEqual({ "logging/__init__.py": ["*"] });
  });
});

describe("guards", () => {
  it("mark a target reached only under TYPE_CHECKING as type-only; ImportError guards change nothing", async (ctx) => {
    const r = await resolve(ctx, {
      "app.py": [
        "from typing import TYPE_CHECKING",
        "if TYPE_CHECKING:",
        "    from models import Order",
        "    from both import A",
        "from both import B",
        "try:",
        "    import fast",
        "except ImportError:",
        "    fast = None",
        "",
      ].join("\n"),
      "models.py": "",
      "both.py": "",
      "fast.py": "",
    });
    expect(r.resolve("app.py").files).toEqual([
      { to: "both.py", symbols: ["A", "B"] },
      { to: "fast.py", symbols: ["*"] },
      { to: "models.py", symbols: ["Order"], typeOnly: true },
    ]);
  });
});

describe("the pack entry", () => {
  it("returns resolved imports and the past-root notice", async (ctx) => {
    skipUnlessGrammar(ctx, pythonGrammarPath());
    const dir = project({ "pkg/__init__.py": "", "pkg/a.py": "from .. import x\nfrom . import b\n", "pkg/b.py": "" });
    const result = await pack.analyzeProject({ projectDir: dir, files: ["pkg/__init__.py", "pkg/a.py", "pkg/b.py"], kinds: ["imports"] });
    expect(result.facts.find((f) => f.path === "pkg/a.py")?.imports?.files).toEqual([{ to: "pkg/b.py", symbols: ["*"] }]);
    expect(result.notices).toEqual(["Python: 1 relative import climbs past its source root and is not resolved: pkg/a.py:1 (..)."]);
  });
});

describe("the stdlib list", () => {
  it("is Python 3.13's: no module removed by 3.13, none added after it, no test package", () => {
    for (const removed of ["imp", "distutils", "asyncore", "cgi", "telnetlib", "lib2to3", "nntplib", "audioop"]) {
      expect(PYTHON_STDLIB_MODULES.has(removed)).toBe(false);
    }
    for (const later of ["annotationlib", "compression", "_zstd"]) expect(PYTHON_STDLIB_MODULES.has(later)).toBe(false);
    expect(PYTHON_STDLIB_MODULES.has("test")).toBe(false);
    for (const present of ["os", "sys", "tomllib", "_pyrepl", "winreg", "__future__"]) expect(PYTHON_STDLIB_MODULES.has(present)).toBe(true);
  });
});
