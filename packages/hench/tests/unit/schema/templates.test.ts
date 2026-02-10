import { describe, it, expect } from "vitest";
import {
  BUILT_IN_TEMPLATES,
  findBuiltInTemplate,
} from "../../../src/schema/templates.js";

describe("BUILT_IN_TEMPLATES", () => {
  it("contains at least 3 templates", () => {
    expect(BUILT_IN_TEMPLATES.length).toBeGreaterThanOrEqual(3);
  });

  it("all templates have unique IDs", () => {
    const ids = BUILT_IN_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all templates have required metadata", () => {
    for (const template of BUILT_IN_TEMPLATES) {
      expect(template.id).toBeTruthy();
      expect(template.name).toBeTruthy();
      expect(template.description).toBeTruthy();
      expect(Array.isArray(template.useCases)).toBe(true);
      expect(template.useCases.length).toBeGreaterThan(0);
      expect(Array.isArray(template.tags)).toBe(true);
      expect(template.tags.length).toBeGreaterThan(0);
      expect(typeof template.config).toBe("object");
      expect(template.builtIn).toBe(true);
    }
  });

  it("all template IDs follow slug format", () => {
    for (const template of BUILT_IN_TEMPLATES) {
      expect(template.id).toMatch(/^[a-z][a-z0-9-]+$/);
    }
  });

  it("templates have non-empty config overrides", () => {
    for (const template of BUILT_IN_TEMPLATES) {
      expect(Object.keys(template.config).length).toBeGreaterThan(0);
    }
  });

  it("config overrides do not include schema field", () => {
    for (const template of BUILT_IN_TEMPLATES) {
      expect("schema" in template.config).toBe(false);
    }
  });
});

describe("findBuiltInTemplate", () => {
  it("finds template by ID", () => {
    const t = findBuiltInTemplate("quick-iteration");
    expect(t).toBeDefined();
    expect(t!.name).toBe("Quick Iteration");
  });

  it("returns undefined for non-existent ID", () => {
    expect(findBuiltInTemplate("nonexistent")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(findBuiltInTemplate("")).toBeUndefined();
  });
});
