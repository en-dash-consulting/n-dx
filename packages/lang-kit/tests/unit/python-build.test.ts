import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { type PythonProject, pythonProjectsFrom, readPythonProjects } from "../../src/python-build.js";

/** Projects over an in-memory repository: path → text. */
function projects(repo: Record<string, string>): Promise<PythonProject[]> {
  return pythonProjectsFrom(Object.keys(repo), async (path) => repo[path]);
}

const deps = (p: PythonProject): string[] =>
  p.dependencies.map((d) => `${d.artifact} ${d.version.resolved ? d.version.value : `(${d.version.reason})`} ${d.scope} ${d.file}:${d.line}`);

describe("Python projects: layouts", () => {
  it("flat: no declared root, packages beside the metadata", async () => {
    const [p] = await projects({
      "pyproject.toml": '[project]\nname = "Flat_App"\ndependencies = [\n  "Requests>=2.31",\n  "click",\n]\n',
      "flat_app/__init__.py": "",
    });
    expect(p).toMatchObject({ dir: "", name: "Flat_App", files: ["pyproject.toml"], packages: [], notices: [] });
    expect(p.sourceRoots).toEqual([{ dir: "", via: "flat layout", inferred: true }]);
    expect(deps(p)).toEqual(["click (no version specifier) main pyproject.toml:5", "requests >=2.31 main pyproject.toml:4"]);
  });

  it("src: a package under src/ makes src the root", async () => {
    const [p] = await projects({ "pyproject.toml": '[project]\nname = "x"\n', "src/x/__init__.py": "", "tests/test_x.py": "" });
    expect(p.sourceRoots).toEqual([{ dir: "src", via: "src layout", inferred: true }]);
    // A namespace package has no __init__.py.
    const [ns] = await projects({ "pyproject.toml": "", "src/ns/sub/mod.py": "" });
    expect(ns.sourceRoots).toEqual([{ dir: "src", via: "src layout", inferred: true }]);
  });

  it("a setup.py inside a package is a module, not build metadata", async () => {
    const found = await projects({
      "pyproject.toml": '[project]\nname = "app"\n',
      "app/__init__.py": "",
      "app/setup.py": "def setup(hass): ...\n",
    });
    expect(found.map((p) => [p.dir, p.files, p.notices])).toEqual([["", ["pyproject.toml"], []]]);
  });

  it("Poetry: packages with from, dependency tables and groups", async () => {
    const [p] = await projects({
      "pyproject.toml": [
        "[tool.poetry]",
        'name = "poetry-app"',
        'packages = [{ include = "app", from = "src" }, { include = "tool.py" }]',
        "[tool.poetry.dependencies]",
        'python = "^3.9"',
        'httpx = "^0.27"',
        'Pydantic = { version = ">=2", extras = ["email"], markers = "python_version >= \'3.10\'" }',
        'local-lib = { path = "../lib", develop = true }',
        "[tool.poetry.group.test.dependencies]",
        'pytest = "*"',
        "[tool.poetry.dev-dependencies]",
        'black = "^24"',
      ].join("\n"),
    });
    expect(p.name).toBe("poetry-app");
    expect(p.sourceRoots).toEqual([
      { dir: "", via: "pyproject.toml [tool.poetry.packages]" },
      { dir: "src", via: "pyproject.toml [tool.poetry.packages]" },
    ]);
    expect(p.packages).toEqual(["app", "tool"]);
    expect(deps(p)).toEqual([
      "black ^24 group:dev pyproject.toml:12",
      "httpx ^0.27 main pyproject.toml:6",
      "local-lib (path dependency) main pyproject.toml:8",
      "pydantic >=2 main pyproject.toml:7",
      "pytest * group:test pyproject.toml:10",
    ]);
    expect(p.dependencies.find((d) => d.artifact === "pydantic")).toMatchObject({ extras: ["email"], marker: "python_version >= '3.10'" });
  });

  it("setuptools: package-dir, packages and packages.find where", async () => {
    const [p] = await projects({
      "pyproject.toml": [
        "[project]",
        'name = "st"',
        "[project.optional-dependencies]",
        'docs = ["sphinx>=7"]',
        "[tool.setuptools]",
        'packages = ["core", "core.sub", "plugin"]',
        "[tool.setuptools.package-dir]",
        '"" = "lib"',
        'plugin = "plugins/the_plugin"',
      ].join("\n"),
    });
    expect(p.sourceRoots).toEqual([
      { dir: "lib", via: "pyproject.toml [tool.setuptools.package-dir]" },
      { dir: "plugins/the_plugin", package: "plugin", via: "pyproject.toml [tool.setuptools.package-dir]" },
    ]);
    expect(p.packages).toEqual(["core", "plugin"]);
    expect(deps(p)).toEqual(["sphinx >=7 optional:docs pyproject.toml:4"]);

    const [found] = await projects({ "svc/pyproject.toml": '[tool.setuptools.packages.find]\nwhere = ["source"]\n' });
    expect(found.sourceRoots).toEqual([{ dir: "svc/source", via: "pyproject.toml [tool.setuptools.packages.find]" }]);
  });

  it("hatch: wheel packages and sources, as a list or a mapping", async () => {
    const [list] = await projects({
      "pyproject.toml": '[tool.hatch.build.targets.wheel]\npackages = ["src/pkg_a"]\nsources = ["src"]\n',
    });
    expect(list.sourceRoots).toEqual([{ dir: "src", via: "pyproject.toml [tool.hatch.build.targets.wheel]" }]);
    expect(list.packages).toEqual(["pkg_a"]);
    const [map] = await projects({
      "pyproject.toml": '[tool.hatch.build.targets.wheel.sources]\n"lib/impl" = "pkg"\n"src" = ""\n',
    });
    expect(map.sourceRoots).toEqual([
      { dir: "lib/impl", package: "pkg", via: "pyproject.toml [tool.hatch.build.targets.wheel]" },
      { dir: "src", via: "pyproject.toml [tool.hatch.build.targets.wheel]" },
    ]);
  });

  it("uv workspace: members are globs over inventory directories with a pyproject.toml", async () => {
    const found = await projects({
      "pyproject.toml": '[project]\nname = "root"\n[tool.uv.workspace]\nmembers = ["packages/*", "apps/**"]\nexclude = ["packages/legacy"]\n',
      "packages/a/pyproject.toml": '[project]\nname = "a"\n',
      "packages/legacy/pyproject.toml": '[project]\nname = "legacy"\n',
      "packages/b/setup.cfg": "[metadata]\nname = b\n",
      "apps/web/api/pyproject.toml": '[project]\nname = "api"\n',
      "packages/c/README.md": "",
    });
    expect(found.map((p) => `${p.dir}=${p.name}`)).toEqual(["=root", "apps/web/api=api", "packages/a=a", "packages/b=b", "packages/legacy=legacy"]);
    expect(found[0].workspaceMembers).toEqual(["apps/web/api", "packages/a"]);
  });

  it("merges pyproject, setup.cfg, setup.py and requirements in one directory", async () => {
    const [p] = await projects({
      "pyproject.toml": "[build-system]\nrequires = [\"setuptools\"]\n",
      "setup.cfg": "[metadata]\nname = merged\n[options]\npackage_dir =\n    = src\npackages = find:\ninstall_requires =\n    six\n    attrs>=21 ; python_version<'3.12'\n[options.packages.find]\nwhere = src\n[options.extras_require]\ntest = pytest\n",
      "setup.py": "from setuptools import setup\nsetup()\n",
      "requirements.txt": "Django==5.0\n",
      "src/merged/__init__.py": "",
    });
    expect(p.name).toBe("merged");
    expect(p.files).toEqual(["pyproject.toml", "requirements.txt", "setup.cfg", "setup.py"]);
    expect(p.sourceRoots).toEqual([{ dir: "src", via: "setup.cfg [options] package_dir" }]);
    expect(deps(p)).toEqual([
      "attrs >=21 main setup.cfg:9",
      "django ==5.0 requirements requirements.txt:1",
      "pytest (no version specifier) optional:test setup.cfg:13",
      "six (no version specifier) main setup.cfg:8",
    ]);
    expect(p.dependencies.find((d) => d.artifact === "attrs")?.marker).toBe("python_version<'3.12'");
  });

  it("setup.py: literal arguments only, find_packages where as a root", async () => {
    const [p] = await projects({
      "setup.py": [
        "import setuptools",
        "VERSION = '1'",
        "setuptools.setup(",
        "    name='legacy',",
        "    version=VERSION,",
        "    package_dir={'': 'src'},",
        "    packages=setuptools.find_packages(where='src', exclude=['tests']),",
        "    install_requires=[",
        "        'requests>=2',",
        "        \"PyYAML\",",
        "    ],",
        "    extras_require={'dev': ['pytest']},",
        ")",
      ].join("\n"),
    });
    expect(p).toMatchObject({ name: "legacy", notices: [] });
    // package_dir and find_packages both name src: one root, first declaration kept.
    expect(p.sourceRoots).toEqual([{ dir: "src", via: "setup.py package_dir" }]);
    expect(deps(p)).toEqual([
      "pytest (no version specifier) optional:dev setup.py:12",
      "pyyaml (no version specifier) main setup.py:10",
      "requests >=2 main setup.py:9",
    ]);
  });

  it("setup.py: a non-literal value is a notice, never a guess", async () => {
    const [p] = await projects({
      "setup.py": "from setuptools import setup\nreqs = open('r.txt').read().splitlines()\nsetup(\n  name=NAME,\n  install_requires=reqs,\n  packages=['a'] + EXTRA,\n  **kw\n)\n",
    });
    expect(p.name).toBeUndefined();
    expect(p.dependencies).toEqual([]);
    expect(p.packages).toEqual([]);
    expect(p.notices).toEqual([
      "setup.py:3: setup() takes **kwargs; arguments not written literally are not read",
      "setup.py:4: name is not a literal; not read",
      "setup.py:6: packages is not a literal; not read",
      "setup.py:5: install_requires is not a literal; not read",
    ]);
  });

  it("requirements: -r and -c includes, a cycle stopped, references kept as written", async () => {
    const [p] = await projects({
      "requirements.txt": "-r requirements/base.txt\n-c constraints.txt\n-e .\n-e git+https://github.com/x/y.git#egg=Y_Pkg\n./vendor/pkg.whl\nfastapi[all] >= 0.110 ; python_version >= '3.9'  # web\n--index-url https://example.org/simple\n",
      "requirements/base.txt": "--requirement=../requirements.txt\nuvicorn \\\n  ==0.29\nrequests @ https://example.org/requests.zip\n-r ../../outside.txt\n",
      "constraints.txt": "urllib3<2\n",
      "pyproject.toml": "",
    });
    expect(p.files).toEqual(["constraints.txt", "pyproject.toml", "requirements.txt", "requirements/base.txt"]);
    expect(deps(p)).toEqual([
      "fastapi >= 0.110 requirements requirements.txt:6",
      "requests (direct reference) requirements requirements/base.txt:4",
      "urllib3 <2 constraint constraints.txt:1",
      "uvicorn ==0.29 requirements requirements/base.txt:2",
    ]);
    expect(p.references).toEqual([
      { text: ".", editable: true, file: "requirements.txt", line: 3 },
      { text: "git+https://github.com/x/y.git#egg=Y_Pkg", editable: true, name: "y-pkg", file: "requirements.txt", line: 4 },
      { text: "./vendor/pkg.whl", editable: false, file: "requirements.txt", line: 5 },
    ]);
    expect(p.notices).toEqual([
      "requirements/base.txt: include cycle requirements.txt -> requirements/base.txt -> requirements.txt; not followed",
      "requirements/base.txt:5: ../../outside.txt is not a file in the repository; not followed",
    ]);
  });

  it("requirements: the egg name is the fragment's last egg= parameter, read from the first #", async () => {
    const hashes = "#".repeat(20_000);
    const [p] = await projects({
      "requirements.txt": [
        "-e git+https://h/x.git#subdirectory=a&egg=First&egg=Last",
        "git+https://h/y.git#sha=1#egg=Second",
        `git+https://h/z.git${hashes}`,
        "",
      ].join("\n"),
    });
    expect(p.references.map((r) => r.name)).toEqual(["last", "second", undefined]);
  });

  it("a requirements-only directory is a project; a nested project owns its own requirements", async () => {
    const found = await projects({
      "requirements-dev.txt": "pytest\n",
      "backend/pyproject.toml": '[project]\nname = "backend"\n',
      "backend/requirements.txt": "sqlmodel\n",
    });
    expect(found.map((p) => [p.dir, p.files, deps(p).length])).toEqual([
      ["", ["requirements-dev.txt"], 1],
      ["backend", ["backend/pyproject.toml", "backend/requirements.txt"], 1],
    ]);
  });

  it("malformed input yields notices, not exceptions", async () => {
    const [p] = await projects({
      "pyproject.toml": "[project\nname = 'x'\n",
      "setup.cfg": "orphan = 1\n[options]\ninstall_requires =\n    not a requirement!\n",
      "setup.py": "setup(name='x\n",
      "requirements.txt": "valid==1\n%%%\n",
    });
    expect(p.dependencies.map((d) => d.artifact)).toEqual(["valid"]);
    expect(p.notices).toEqual([
      expect.stringMatching(/^pyproject\.toml:1: not read: /),
      "setup.cfg:1: key outside any section",
      "setup.cfg:4: not a requirement: not a requirement!",
      "setup.py: line 1: unterminated string",
      "requirements.txt:2: not a requirement: %%%",
    ]);
  });

  it("a pyproject.toml with an out-of-range escape is a notice, not a RangeError", async () => {
    const [p] = await projects({ "pyproject.toml": '[project]\nname = "\\UFFFFFFFF"\n' });
    expect(p.notices).toEqual([expect.stringMatching(/^pyproject\.toml:2: not read: invalid unicode escape/)]);
  });

  it("refuses a root that leaves the repository", async () => {
    const [p] = await projects({ "pyproject.toml": '[tool.setuptools.package-dir]\n"" = "../elsewhere"\n' });
    expect(p.notices).toEqual(["pyproject.toml:2: ../elsewhere leaves the repository; not read"]);
    expect(p.sourceRoots).toEqual([{ dir: "", via: "flat layout", inferred: true }]);
  });
});

describe("readPythonProjects", () => {
  const cleanups: string[] = [];
  afterEach(async () => {
    for (const d of cleanups.splice(0)) await rm(d, { recursive: true, force: true });
  });

  it("reads the files the inventory lists from disk, and reports one that is gone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "python-build-"));
    cleanups.push(dir);
    const write = async (rel: string, text: string): Promise<void> => {
      await mkdir(dirname(join(dir, rel)), { recursive: true });
      await writeFile(join(dir, rel), text);
    };
    await write("app/pyproject.toml", '[project]\nname = "app"\ndependencies = ["rich"]\n');
    const found = await readPythonProjects(dir, ["app/pyproject.toml", "app/setup.cfg"]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ dir: "app", name: "app", notices: ["app/setup.cfg is unreadable"] });
    expect(deps(found[0])).toEqual(["rich (no version specifier) main app/pyproject.toml:3"]);
  });
});
