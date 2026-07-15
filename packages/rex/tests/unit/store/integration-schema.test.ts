/**
 * Tests for the integration schema system.
 *
 * Validates schema registration, field validation, config validation,
 * backward compatibility with AdapterConfigField, and built-in schema
 * definitions (Notion, Jira).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  validateField,
  validateConfig,
  registerIntegrationSchema,
  getIntegrationSchema,
  listIntegrationSchemas,
  resetIntegrationSchemas,
  toAdapterConfigSchema,
  type IntegrationSchema,
  type IntegrationFieldSchema,
} from "../../../src/store/integration-schema.js";
import { notionIntegrationSchema } from "../../../src/store/integration-schemas/notion.js";
import { jiraIntegrationSchema } from "../../../src/store/integration-schemas/jira.js";
import {
  registerBuiltInSchemas,
  ensureSchemas,
  resetRegistration,
} from "../../../src/store/integration-schemas/index.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetIntegrationSchemas();
  resetRegistration();
});

// ---------------------------------------------------------------------------
// Schema registration
// ---------------------------------------------------------------------------

describe("Integration schema registry", () => {
  it("registers and retrieves a schema", () => {
    const schema: IntegrationSchema = {
      id: "test",
      name: "Test",
      description: "A test integration",
      fields: {
        apiKey: { required: true, description: "API key", sensitive: true },
      },
    };

    registerIntegrationSchema(schema);
    expect(getIntegrationSchema("test")).toEqual(schema);
  });

  it("lists all registered schemas", () => {
    registerIntegrationSchema({
      id: "alpha",
      name: "Alpha",
      description: "First",
      fields: {},
    });
    registerIntegrationSchema({
      id: "beta",
      name: "Beta",
      description: "Second",
      fields: {},
    });

    const list = listIntegrationSchemas();
    expect(list).toHaveLength(2);
    expect(list.map((s) => s.id).sort()).toEqual(["alpha", "beta"]);
  });

  it("throws on duplicate registration", () => {
    registerIntegrationSchema({
      id: "dup",
      name: "Dup",
      description: "Duplicate",
      fields: {},
    });

    expect(() =>
      registerIntegrationSchema({
        id: "dup",
        name: "Dup Again",
        description: "Duplicate",
        fields: {},
      }),
    ).toThrow('Integration schema "dup" is already registered');
  });

  it("returns undefined for unknown schema", () => {
    expect(getIntegrationSchema("nonexistent")).toBeUndefined();
  });

  it("resetIntegrationSchemas clears the registry", () => {
    registerIntegrationSchema({
      id: "temp",
      name: "Temp",
      description: "Temporary",
      fields: {},
    });
    expect(listIntegrationSchemas()).toHaveLength(1);

    resetIntegrationSchemas();
    expect(listIntegrationSchemas()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Field validation
// ---------------------------------------------------------------------------

describe("validateField", () => {
  it("passes for valid required field", () => {
    const schema: IntegrationFieldSchema = {
      required: true,
      description: "Name",
      label: "Name",
    };
    expect(validateField("hello", schema)).toEqual({ valid: true });
  });

  it("fails for empty required field", () => {
    const schema: IntegrationFieldSchema = {
      required: true,
      description: "Name",
      label: "Name",
    };
    expect(validateField("", schema)).toEqual({
      valid: false,
      error: "Name is required",
    });
  });

  it("passes for empty optional field", () => {
    const schema: IntegrationFieldSchema = {
      required: false,
      description: "Optional",
    };
    expect(validateField("", schema)).toEqual({ valid: true });
    expect(validateField(undefined, schema)).toEqual({ valid: true });
    expect(validateField(null, schema)).toEqual({ valid: true });
  });

  it("validates pattern rules", () => {
    const schema: IntegrationFieldSchema = {
      required: false,
      description: "Token",
      validationRules: [
        {
          type: "pattern",
          pattern: "^(secret_|ntn_)",
          message: "Must start with secret_ or ntn_",
        },
      ],
    };

    expect(validateField("secret_abc", schema).valid).toBe(true);
    expect(validateField("ntn_xyz", schema).valid).toBe(true);
    expect(validateField("invalid", schema)).toEqual({
      valid: false,
      error: "Must start with secret_ or ntn_",
    });
  });

  it("validates minLength rules", () => {
    const schema: IntegrationFieldSchema = {
      required: false,
      description: "Key",
      validationRules: [
        { type: "minLength", minLength: 10, message: "Too short" },
      ],
    };

    expect(validateField("abcdefghij", schema).valid).toBe(true);
    expect(validateField("short", schema)).toEqual({
      valid: false,
      error: "Too short",
    });
  });

  it("validates maxLength rules", () => {
    const schema: IntegrationFieldSchema = {
      required: false,
      description: "Key",
      validationRules: [
        { type: "maxLength", maxLength: 5, message: "Too long" },
      ],
    };

    expect(validateField("hello", schema).valid).toBe(true);
    expect(validateField("toolongvalue", schema)).toEqual({
      valid: false,
      error: "Too long",
    });
  });

  it("validates min/max numeric rules", () => {
    const schema: IntegrationFieldSchema = {
      required: false,
      description: "Port",
      validationRules: [
        { type: "min", min: 1, message: "Must be >= 1" },
        { type: "max", max: 65535, message: "Must be <= 65535" },
      ],
    };

    expect(validateField(8080, schema).valid).toBe(true);
    expect(validateField(0, schema)).toEqual({ valid: false, error: "Must be >= 1" });
    expect(validateField(99999, schema)).toEqual({
      valid: false,
      error: "Must be <= 65535",
    });
  });

  it("returns first failing rule's error", () => {
    const schema: IntegrationFieldSchema = {
      required: false,
      description: "Key",
      validationRules: [
        { type: "minLength", minLength: 5, message: "Too short" },
        { type: "pattern", pattern: "^[A-Z]+$", message: "Uppercase only" },
      ],
    };

    // "ab" fails minLength first
    expect(validateField("ab", schema)).toEqual({
      valid: false,
      error: "Too short",
    });

    // "abcde" passes minLength but fails pattern
    expect(validateField("abcde", schema)).toEqual({
      valid: false,
      error: "Uppercase only",
    });

    // "ABCDE" passes both
    expect(validateField("ABCDE", schema).valid).toBe(true);
  });

  it("skips custom validators (handled externally)", () => {
    const schema: IntegrationFieldSchema = {
      required: false,
      description: "Key",
      validationRules: [
        { type: "custom", validator: "notionApiKey", message: "Invalid" },
      ],
    };

    // Custom rules are skipped in validateField
    expect(validateField("anything", schema).valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

describe("validateConfig", () => {
  it("returns empty errors for valid config", () => {
    const schema: IntegrationSchema = {
      id: "test",
      name: "Test",
      description: "Test",
      fields: {
        name: { required: true, description: "Name" },
        optional: { required: false, description: "Optional" },
      },
    };

    const errors = validateConfig({ name: "hello" }, schema);
    expect(Object.keys(errors)).toHaveLength(0);
  });

  it("returns errors for missing required fields", () => {
    const schema: IntegrationSchema = {
      id: "test",
      name: "Test",
      description: "Test",
      fields: {
        token: { required: true, description: "Token", label: "Token" },
        url: { required: true, description: "URL", label: "URL" },
      },
    };

    const errors = validateConfig({}, schema);
    expect(Object.keys(errors)).toHaveLength(2);
    expect(errors.token.valid).toBe(false);
    expect(errors.url.valid).toBe(false);
  });

  it("validates field rules in config", () => {
    const schema: IntegrationSchema = {
      id: "test",
      name: "Test",
      description: "Test",
      fields: {
        key: {
          required: true,
          description: "Key",
          validationRules: [
            { type: "minLength", minLength: 10, message: "Too short" },
          ],
        },
      },
    };

    const errors = validateConfig({ key: "short" }, schema);
    expect(errors.key).toEqual({ valid: false, error: "Too short" });
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility: toAdapterConfigSchema
// ---------------------------------------------------------------------------

describe("toAdapterConfigSchema", () => {
  it("extracts base AdapterConfigField map", () => {
    const schema: IntegrationSchema = {
      id: "test",
      name: "Test",
      description: "Test",
      fields: {
        token: {
          required: true,
          sensitive: true,
          description: "Token",
          label: "API Token",
          inputType: "password",
          placeholder: "Enter token",
          helpText: "Get this from your dashboard",
          validationRules: [
            { type: "minLength", minLength: 10, message: "Too short" },
          ],
        },
        name: {
          required: false,
          description: "Display name",
          label: "Name",
        },
      },
    };

    const result = toAdapterConfigSchema(schema);

    // Should only contain base AdapterConfigField properties
    expect(result).toEqual({
      token: { required: true, description: "Token", sensitive: true },
      name: { required: false, description: "Display name", sensitive: undefined },
    });

    // Should NOT contain extended properties
    expect(result.token).not.toHaveProperty("label");
    expect(result.token).not.toHaveProperty("inputType");
    expect(result.token).not.toHaveProperty("placeholder");
    expect(result.token).not.toHaveProperty("helpText");
    expect(result.token).not.toHaveProperty("validationRules");
  });
});

// ---------------------------------------------------------------------------
// Built-in schemas
// ---------------------------------------------------------------------------

describe("Built-in integration schemas", () => {
  describe("Notion schema", () => {
    it("has correct ID and metadata", () => {
      expect(notionIntegrationSchema.id).toBe("notion");
      expect(notionIntegrationSchema.name).toBe("Notion");
      expect(notionIntegrationSchema.builtIn).toBe(true);
      expect(notionIntegrationSchema.supportsConnectionTest).toBe(true);
      expect(notionIntegrationSchema.supportsSchemaValidation).toBe(true);
    });

    it("has token and databaseId fields", () => {
      const fields = notionIntegrationSchema.fields;
      expect(fields.token).toBeDefined();
      expect(fields.token.required).toBe(true);
      expect(fields.token.sensitive).toBe(true);
      expect(fields.token.inputType).toBe("password");

      expect(fields.databaseId).toBeDefined();
      expect(fields.databaseId.required).toBe(true);
      expect(fields.databaseId.sensitive).toBe(false);
    });

    it("token validation matches existing patterns", () => {
      // Valid tokens
      expect(validateField("secret_abcdefghijklmnopqrs", notionIntegrationSchema.fields.token).valid).toBe(true);
      expect(validateField("ntn_abcdefghijklmnopqrst", notionIntegrationSchema.fields.token).valid).toBe(true);

      // Invalid: wrong prefix
      const invalidPrefix = validateField("invalid_token_value_here", notionIntegrationSchema.fields.token);
      expect(invalidPrefix.valid).toBe(false);

      // Invalid: too short
      const tooShort = validateField("secret_abc", notionIntegrationSchema.fields.token);
      expect(tooShort.valid).toBe(false);
    });

    it("databaseId validation matches UUID pattern", () => {
      // Valid UUIDs
      expect(validateField("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4", notionIntegrationSchema.fields.databaseId).valid).toBe(true);
      expect(validateField("a1b2c3d4-e5f6-a1b2-c3d4-e5f6a1b2c3d4", notionIntegrationSchema.fields.databaseId).valid).toBe(true);

      // Invalid: not hex
      const notHex = validateField("not-a-valid-uuid-at-all!", notionIntegrationSchema.fields.databaseId);
      expect(notHex.valid).toBe(false);
    });

    it("has setup guide", () => {
      expect(notionIntegrationSchema.setupGuide).toBeDefined();
      expect(notionIntegrationSchema.setupGuide!.length).toBeGreaterThan(0);
    });

    it("backward compat: converts to AdapterConfigField", () => {
      const adapterSchema = toAdapterConfigSchema(notionIntegrationSchema);
      expect(adapterSchema.token).toEqual({
        required: true,
        description: "Notion integration token (secret_xxx or ntn_xxx)",
        sensitive: true,
      });
      expect(adapterSchema.databaseId).toEqual({
        required: true,
        description: "Notion database ID",
        sensitive: false,
      });
    });
  });

  describe("Jira schema", () => {
    it("has correct ID and metadata", () => {
      expect(jiraIntegrationSchema.id).toBe("jira");
      expect(jiraIntegrationSchema.name).toBe("Jira");
      // Promoted to a built-in when the Jira store adapter shipped.
      expect(jiraIntegrationSchema.builtIn).toBe(true);
      expect(jiraIntegrationSchema.supportsConnectionTest).toBe(true);
    });

    it("supports multiple input types", () => {
      const fields = jiraIntegrationSchema.fields;

      // URL input
      expect(fields.domain.inputType).toBe("url");

      // Email input
      expect(fields.email.inputType).toBe("email");

      // Password input
      expect(fields.apiToken.inputType).toBe("password");
      expect(fields.apiToken.sensitive).toBe(true);

      // Text input
      expect(fields.projectKey.inputType).toBe("text");

      // Select input
      expect(fields.issueType.inputType).toBe("select");
      expect(fields.issueType.options).toBeDefined();
      expect(fields.issueType.options!.length).toBeGreaterThan(0);

      // Checkbox input
      expect(fields.syncLabels.inputType).toBe("checkbox");
      expect(fields.syncLabels.defaultValue).toBe(true);
    });

    it("has field groups", () => {
      expect(jiraIntegrationSchema.groups).toBeDefined();
      expect(jiraIntegrationSchema.groups!.connection).toBeDefined();
      expect(jiraIntegrationSchema.groups!.project).toBeDefined();
    });

    it("validates domain format", () => {
      const field = jiraIntegrationSchema.fields.domain;
      expect(validateField("mycompany.atlassian.net", field).valid).toBe(true);
      expect(validateField("invalid.example.com", field).valid).toBe(false);
    });

    it("validates project key format", () => {
      const field = jiraIntegrationSchema.fields.projectKey;
      expect(validateField("PRD", field).valid).toBe(true);
      expect(validateField("MY_PROJECT", field).valid).toBe(true);
      expect(validateField("lowercase", field).valid).toBe(false);
      expect(validateField("A", field).valid).toBe(false); // too short
    });

    it("validates email format", () => {
      const field = jiraIntegrationSchema.fields.email;
      expect(validateField("user@company.com", field).valid).toBe(true);
      expect(validateField("not-an-email", field).valid).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Built-in schema registration
// ---------------------------------------------------------------------------

describe("registerBuiltInSchemas", () => {
  it("registers Notion, Jira, Asana, and GitHub schemas", () => {
    registerBuiltInSchemas();
    expect(getIntegrationSchema("notion")).toBeDefined();
    expect(getIntegrationSchema("jira")).toBeDefined();
    expect(getIntegrationSchema("asana")).toBeDefined();
    expect(getIntegrationSchema("github")).toBeDefined();
  });

  it("is idempotent (safe to call multiple times)", () => {
    registerBuiltInSchemas();
    registerBuiltInSchemas(); // should not throw
    expect(listIntegrationSchemas()).toHaveLength(4);
  });

  it("ensureSchemas returns full list", () => {
    const schemas = ensureSchemas();
    expect(schemas).toHaveLength(4);
    expect(schemas.map((s) => s.id).sort()).toEqual(["asana", "github", "jira", "notion"]);
  });
});
