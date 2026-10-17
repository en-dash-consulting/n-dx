import { describe, expect, it } from "vitest";

import { normalizePythonName, parseRequirement } from "../../src/python-requirements.js";

describe("normalizePythonName (PEP 503)", () => {
  it.each([
    ["Django", "django"],
    ["zope.interface", "zope-interface"],
    ["Foo__Bar-.baz", "foo-bar-baz"],
    ["typing_extensions", "typing-extensions"],
  ])("%s → %s", (name, expected) => {
    expect(normalizePythonName(name)).toBe(expected);
  });
});

describe("parseRequirement (PEP 508)", () => {
  it("splits name, extras, specifier and marker, each as written", () => {
    expect(parseRequirement("requests[security, socks] >=2.8.1, ==2.8.* ; python_version < '2.7'")).toEqual({
      name: "requests",
      extras: ["security", "socks"],
      spec: ">=2.8.1, ==2.8.*",
      marker: "python_version < '2.7'",
    });
    expect(parseRequirement("name (>=1.0)")).toEqual({ name: "name", extras: [], spec: "(>=1.0)" });
    expect(parseRequirement("A")).toEqual({ name: "A", extras: [], spec: "" });
    expect(parseRequirement("pkg~=1.4.2")).toEqual({ name: "pkg", extras: [], spec: "~=1.4.2" });
  });

  it("reads a direct reference and the marker after it", () => {
    expect(parseRequirement("pip @ https://github.com/pypa/pip/archive/1.3.1.zip ; python_version >= '3'")).toEqual({
      name: "pip",
      extras: [],
      spec: "",
      url: "https://github.com/pypa/pip/archive/1.3.1.zip",
      marker: "python_version >= '3'",
    });
  });

  it.each(["", "-e .", "name >= ", "name[extra", "name; ", "name >=1 junk", "pkg @ "])("rejects %j", (text) => {
    expect(parseRequirement(text)).toBeUndefined();
  });

  it("accepts clauses joined by a comma, by whitespace, or by nothing, and a trailing comma", () => {
    for (const spec of [">=1,<2", ">=1 , <2", ">=1 <2", ">=1<2", ">=1,", "(>= 1 , < 2 )", "==1!=2", "==1!==2"]) {
      expect(parseRequirement(`pkg ${spec}`)?.spec).toBe(spec);
    }
    for (const spec of [">=1,,<2", ",>=1", ">=1 2"]) expect(parseRequirement(`pkg ${spec}`)).toBeUndefined();
  });

  // The specifier pattern once let two adjacent `\s*` split the same whitespace
  // k+1 ways, so a failing tail backtracked as (k+1)^m: m=18 took ~10 s and
  // this line (m=30) would not return. A regression hangs the suite rather than
  // failing it — no clock is read, because none could interrupt the match.
  it("rejects a pathological specifier promptly", () => {
    const text = "pkg " + "==1  ".repeat(30) + "x";
    expect(text.length).toBeGreaterThan(100);
    expect(parseRequirement(text)).toBeUndefined();
  });
});
