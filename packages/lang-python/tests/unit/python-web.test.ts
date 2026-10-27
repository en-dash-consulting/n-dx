/**
 * The value and path rules the Python web frameworks share: what a literal
 * is, the `${…}` form of what is not, and how a prefix meets a path.
 */

import { describe, expect, it } from "vitest";
import type { Capture } from "@n-dx/lang-runtime";
import { joinPrefix, joinWebPath, lastName, stringValue, webValue } from "../../src/python-web.js";

const node = (nodeType: string, text: string): Capture => ({
  name: "x",
  nodeType,
  text,
  start: { line: 1, column: 0 },
  end: { line: 1, column: text.length },
});

describe("stringValue", () => {
  it("reads plain, raw, triple-quoted and implicitly concatenated literals", () => {
    expect(stringValue('"/items"')).toEqual({ text: "/items", literal: true });
    expect(stringValue("r'^(?P<slug>[\\w-]+)/$'")).toEqual({ text: "^(?P<slug>[\\w-]+)/$", literal: true });
    expect(stringValue('"""/a"""')).toEqual({ text: "/a", literal: true });
    expect(stringValue('"a/" \'b/\'')).toEqual({ text: "a/b/", literal: true });
    expect(stringValue('"a/"  # part one\n  "b"')).toEqual({ text: "a/b", literal: true });
  });

  it("processes escapes outside raw strings and keeps the backslash of an unknown one", () => {
    expect(stringValue('"a\\"b"')).toEqual({ text: 'a"b', literal: true });
    expect(stringValue('"\\d+"')).toEqual({ text: "\\d+", literal: true });
  });

  it("gives an f-string's fields the ${…} form and is not a literal", () => {
    expect(stringValue('f"{settings.API_V1_STR}/items"')).toEqual({ text: "${settings.API_V1_STR}/items", literal: false });
    expect(stringValue('f"/{v!r:>4}/{{x}}"')).toEqual({ text: "/${v}/{x}", literal: false });
    expect(stringValue('"/a" f"{b}"')).toEqual({ text: "/a${b}", literal: false });
  });

  it("is undefined for what is not a string literal", () => {
    expect(stringValue("PREFIX")).toBeUndefined();
    expect(stringValue('"/a" + b')).toBeUndefined();
  });
});

describe("webValue", () => {
  it("keeps an expression as written in ${…} form", () => {
    expect(webValue(node("attribute", "settings.API_V1_STR"))).toEqual({ text: "${settings.API_V1_STR}", literal: false });
    expect(webValue(node("binary_operator", 'PREFIX +\n    "/x"'))).toEqual({ text: '${PREFIX + "/x"}', literal: false });
  });

  it("reads a parenthesized literal", () => {
    expect(webValue(node("parenthesized_expression", '("a/"\n "b/")'))).toEqual({ text: "a/b/", literal: true });
  });
});

describe("joinPrefix and joinWebPath", () => {
  it("joins with exactly one slash and keeps a trailing slash", () => {
    expect(joinWebPath("/items", "/")).toBe("/items/");
    expect(joinWebPath("/items/", "/{id}")).toBe("/items/{id}");
    expect(joinWebPath("api/", "items/")).toBe("/api/items/");
    expect(joinWebPath("/admin", "")).toBe("/admin");
    expect(joinWebPath("blog/", "")).toBe("/blog/");
    expect(joinWebPath("", "")).toBe("/");
  });

  it("starts with a slash unless the path starts with a placeholder or a regex anchor", () => {
    expect(joinWebPath("${settings.API_V1_STR}", "/items/")).toBe("${settings.API_V1_STR}/items/");
    expect(joinWebPath("", "^(?P<slug>[\\w-]+)/$")).toBe("^(?P<slug>[\\w-]+)/$");
  });

  it("composes prefixes without adding a slash", () => {
    expect(joinPrefix("", "")).toBe("");
    expect(joinPrefix("", "${p}")).toBe("${p}");
    expect(joinPrefix("${p}", "/items")).toBe("${p}/items");
  });
});

describe("lastName", () => {
  it("is the last segment of a dotted name, whitespace removed", () => {
    expect(lastName("views.home")).toBe("home");
    expect(lastName("views .\n SiteListView")).toBe("SiteListView");
    expect(lastName("home")).toBe("home");
  });
});
