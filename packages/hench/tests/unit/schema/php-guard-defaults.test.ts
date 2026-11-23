import { describe, it, expect } from "vitest";
import { guardDefaultsForLanguage, DEFAULT_HENCH_CONFIG } from "../../../src/schema/v1.js";
import { validateConfig } from "../../../src/schema/validate.js";
import { findBuiltInTemplate } from "../../../src/schema/templates.js";

const PHP_TOOLS = ["php", "composer", "phpunit"];

describe("PHP guard defaults", () => {
  it("admits php, composer and vendor/bin/phpunit (base name phpunit)", () => {
    const guard = guardDefaultsForLanguage("php");
    expect(guard.allowedCommands).toEqual(["php", "composer", "phpunit", "git"]);
    expect(guard.commandTimeout).toBe(30000);
    expect(guard.spawnTimeout).toBe(300000);
  });

  it("blocks vendor/ and n-dx state like every language", () => {
    const { blockedPaths } = guardDefaultsForLanguage("php");
    for (const p of ["**/vendor/**", "**/node_modules/**", ".hench/**", ".rex/**", ".git/**"]) {
      expect(blockedPaths).toContain(p);
    }
  });

  it("admits the PHP tools for PHP projects only", () => {
    for (const lang of [undefined, "typescript", "javascript", "go", "swift"] as const) {
      const { allowedCommands } = guardDefaultsForLanguage(lang);
      for (const tool of PHP_TOOLS) expect(allowedCommands, `${lang}: ${tool}`).not.toContain(tool);
    }
  });

  it("leaves the TypeScript and Go defaults unchanged", () => {
    expect(guardDefaultsForLanguage("typescript").allowedCommands).toEqual(["npm", "npx", "node", "git", "tsc", "vitest"]);
    expect(guardDefaultsForLanguage().allowedCommands).toEqual(["npm", "npx", "node", "git", "tsc", "vitest"]);
    expect(guardDefaultsForLanguage("go").allowedCommands).toEqual(["go", "make", "git", "golangci-lint"]);
    expect(guardDefaultsForLanguage("go").commandTimeout).toBe(30000);
    expect(guardDefaultsForLanguage("typescript").commandTimeout).toBe(30000);
  });

  it("writes a config hench itself loads", () => {
    const config = DEFAULT_HENCH_CONFIG("php");
    config.language = "php";
    expect(validateConfig(config).ok).toBe(true);
  });

  it("ships a php-project template with the PHP guard", () => {
    const template = findBuiltInTemplate("php-project");
    expect(template?.config.language).toBe("php");
    expect(template?.config.guard).toEqual(guardDefaultsForLanguage("php"));
  });
});
