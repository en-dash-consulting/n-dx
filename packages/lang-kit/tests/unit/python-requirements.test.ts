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
});
