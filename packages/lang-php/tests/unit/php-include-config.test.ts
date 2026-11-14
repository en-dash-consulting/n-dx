import { describe, expect, it } from "vitest";
import { parsePhpIncludeConfig } from "../../src/php-includes.js";

const values = (kind: Parameters<typeof parsePhpIncludeConfig>[1], text: string): string[] =>
  parsePhpIncludeConfig("x", kind, text).map((c) => c.value);

describe("parsePhpIncludeConfig", () => {
  it("reads quoted and unquoted ini values, without their comments", () => {
    expect(values("php.ini", 'include_path = ".:lib" ; dev\n')).toEqual([".:lib"]);
    expect(values(".user.ini", "include_path=lib:pear ; comment\n")).toEqual(["lib:pear"]);
    expect(values("php.ini", "; include_path = \".:/x\"\nmemory_limit = 1G\n")).toEqual([]);
  });

  it("reads php_value include_path from .htaccess in any letter case, but not other settings", () => {
    expect(values(".htaccess", '  PHP_Value include_path ".:../lib"\nphp_value memory_limit 1G\n')).toEqual([".:../lib"]);
    expect(values(".htaccess", "php_flag include_path on\n")).toEqual([]);
  });
});
