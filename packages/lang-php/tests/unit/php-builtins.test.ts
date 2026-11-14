import { describe, expect, it } from "vitest";
import { isPhpBuiltinClass } from "../../src/index.js";

describe("isPhpBuiltinClass", () => {
  it("knows PHP's own classes and interfaces, in any letter case", () => {
    for (const name of ["Exception", "stdclass", "ArrayAccess", "PDO", "DateTimeImmutable", "SplObjectStorage", "mysqli", "ZipArchive"]) {
      expect(isPhpBuiltinClass(name), name).toBe(true);
    }
  });

  it("knows the namespaces PHP declares classes in", () => {
    expect(isPhpBuiltinClass("Random\\Randomizer")).toBe(true);
    expect(isPhpBuiltinClass("Dom\\HTMLDocument")).toBe(true);
  });

  it("does not claim libraries, PECL extensions or namespaced look-alikes", () => {
    for (const name of ["Monolog\\Logger", "Zend_Db_Table", "Memcached", "Redis", "App\\Exception", "Smarty"]) {
      expect(isPhpBuiltinClass(name), name).toBe(false);
    }
  });
});
