import { describe, it, expect } from "vitest";
import type {
  JsonSchemaType,
  ToolPropertySchema,
  ToolInputSchema,
  ToolDefinition,
  AnthropicToolDef,
  OpenAiToolDef,
} from "../../src/tool-schema.js";
import {
  toAnthropicToolDef,
  toAnthropicToolDefs,
  toOpenAiToolDef,
  toOpenAiToolDefs,
} from "../../src/tool-schema.js";

// ── Fixtures ──────────────────────────────────────────────────────────────

const SIMPLE_TOOL: ToolDefinition = {
  name: "read_file",
  description: "Read the contents of a file.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path" },
    },
    required: ["path"],
  },
};

const MULTI_PARAM_TOOL: ToolDefinition = {
  name: "write_file",
  description: "Write content to a file.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path" },
      content: { type: "string", description: "File content" },
    },
    required: ["path", "content"],
  },
};

const ENUM_TOOL: ToolDefinition = {
  name: "update_status",
  description: "Update task status.",
  inputSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        description: "New status",
        enum: ["pending", "in_progress", "completed"],
      },
    },
    required: ["status"],
  },
};

const OPTIONAL_PARAMS_TOOL: ToolDefinition = {
  name: "run_command",
  description: "Run a shell command.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command" },
      cwd: { type: "string", description: "Working directory" },
      timeout: { type: "number", description: "Timeout in ms" },
    },
    required: ["command"],
  },
};

const BOOLEAN_PARAM_TOOL: ToolDefinition = {
  name: "list_directory",
  description: "List files in a directory.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path" },
      recursive: { type: "boolean", description: "List recursively" },
    },
    required: ["path"],
  },
};

const NESTED_OBJECT_TOOL: ToolDefinition = {
  name: "configure",
  description: "Set configuration options.",
  inputSchema: {
    type: "object",
    properties: {
      options: {
        type: "object",
        description: "Configuration object",
        properties: {
          verbose: { type: "boolean", description: "Enable verbose output" },
          level: { type: "string", description: "Log level", enum: ["debug", "info", "warn"] },
        },
        required: ["verbose"],
      },
    },
    required: ["options"],
  },
};

const ARRAY_PARAM_TOOL: ToolDefinition = {
  name: "tag_items",
  description: "Apply tags to items.",
  inputSchema: {
    type: "object",
    properties: {
      tags: {
        type: "array",
        description: "List of tags",
        items: { type: "string" },
      },
    },
    required: ["tags"],
  },
};

// ── ToolDefinition type tests ─────────────────────────────────────────────

describe("ToolDefinition", () => {
  it("accepts a minimal tool definition", () => {
    const tool: ToolDefinition = SIMPLE_TOOL;
    expect(tool.name).toBe("read_file");
    expect(tool.description).toBe("Read the contents of a file.");
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.inputSchema.required).toEqual(["path"]);
  });

  it("accepts all JsonSchemaType values", () => {
    const types: JsonSchemaType[] = ["string", "number", "integer", "boolean", "array", "object"];
    for (const t of types) {
      const prop: ToolPropertySchema = { type: t };
      expect(prop.type).toBe(t);
    }
  });

  it("supports enum constraints on properties", () => {
    expect(ENUM_TOOL.inputSchema.properties.status.enum).toEqual([
      "pending", "in_progress", "completed",
    ]);
  });

  it("supports nested object properties", () => {
    const opts = NESTED_OBJECT_TOOL.inputSchema.properties.options;
    expect(opts.type).toBe("object");
    expect(opts.properties?.verbose.type).toBe("boolean");
    expect(opts.required).toEqual(["verbose"]);
  });

  it("supports array properties with item schema", () => {
    const tags = ARRAY_PARAM_TOOL.inputSchema.properties.tags;
    expect(tags.type).toBe("array");
    expect(tags.items?.type).toBe("string");
  });
});

// ── toAnthropicToolDef ────────────────────────────────────────────────────

describe("toAnthropicToolDef", () => {
  it("compiles a simple tool definition", () => {
    const result = toAnthropicToolDef(SIMPLE_TOOL);

    expect(result.name).toBe("read_file");
    expect(result.description).toBe("Read the contents of a file.");
    expect(result.input_schema.type).toBe("object");
    expect(result.input_schema.properties).toEqual({
      path: { type: "string", description: "File path" },
    });
    expect(result.input_schema.required).toEqual(["path"]);
  });

  it("compiles multi-parameter tools", () => {
    const result = toAnthropicToolDef(MULTI_PARAM_TOOL);

    expect(Object.keys(result.input_schema.properties)).toHaveLength(2);
    expect(result.input_schema.required).toEqual(["path", "content"]);
  });

  it("preserves enum constraints", () => {
    const result = toAnthropicToolDef(ENUM_TOOL);

    const statusProp = result.input_schema.properties.status as Record<string, unknown>;
    expect(statusProp.enum).toEqual(["pending", "in_progress", "completed"]);
  });

  it("handles optional parameters (not in required array)", () => {
    const result = toAnthropicToolDef(OPTIONAL_PARAMS_TOOL);

    expect(result.input_schema.required).toEqual(["command"]);
    expect(Object.keys(result.input_schema.properties)).toHaveLength(3);
  });

  it("compiles boolean parameters", () => {
    const result = toAnthropicToolDef(BOOLEAN_PARAM_TOOL);

    const recursiveProp = result.input_schema.properties.recursive as Record<string, unknown>;
    expect(recursiveProp.type).toBe("boolean");
    expect(recursiveProp.description).toBe("List recursively");
  });

  it("compiles nested object properties", () => {
    const result = toAnthropicToolDef(NESTED_OBJECT_TOOL);

    const optionsProp = result.input_schema.properties.options as Record<string, unknown>;
    expect(optionsProp.type).toBe("object");
    const nestedProps = optionsProp.properties as Record<string, unknown>;
    expect(nestedProps.verbose).toEqual({ type: "boolean", description: "Enable verbose output" });
    expect(optionsProp.required).toEqual(["verbose"]);
  });

  it("compiles array properties with items", () => {
    const result = toAnthropicToolDef(ARRAY_PARAM_TOOL);

    const tagsProp = result.input_schema.properties.tags as Record<string, unknown>;
    expect(tagsProp.type).toBe("array");
    expect(tagsProp.items).toEqual({ type: "string" });
  });

  it("uses snake_case input_schema key (Anthropic convention)", () => {
    const result = toAnthropicToolDef(SIMPLE_TOOL);
    expect("input_schema" in result).toBe(true);
    expect("inputSchema" in result).toBe(false);
  });

  it("produces mutable output (no readonly wrappers)", () => {
    const result = toAnthropicToolDef(SIMPLE_TOOL);

    // Should be able to mutate without type errors at runtime
    result.input_schema.required.push("extra");
    expect(result.input_schema.required).toContain("extra");
  });

  it("does not mutate the original tool definition", () => {
    const result = toAnthropicToolDef(ENUM_TOOL);

    // Mutating the output should not affect the input
    (result.input_schema.properties.status as Record<string, unknown>).description = "changed";
    expect(ENUM_TOOL.inputSchema.properties.status.description).toBe("New status");

    result.input_schema.required.push("extra");
    expect(ENUM_TOOL.inputSchema.required).toEqual(["status"]);
  });
});

// ── toAnthropicToolDefs (batch) ──────────────────────────────────────────

describe("toAnthropicToolDefs", () => {
  it("compiles an array of tool definitions", () => {
    const results = toAnthropicToolDefs([SIMPLE_TOOL, ENUM_TOOL]);

    expect(results).toHaveLength(2);
    expect(results[0].name).toBe("read_file");
    expect(results[1].name).toBe("update_status");
  });

  it("returns an empty array for empty input", () => {
    expect(toAnthropicToolDefs([])).toEqual([]);
  });
});

// ── toOpenAiToolDef ──────────────────────────────────────────────────────

describe("toOpenAiToolDef", () => {
  it("compiles a simple tool definition", () => {
    const result = toOpenAiToolDef(SIMPLE_TOOL);

    expect(result.type).toBe("function");
    expect(result.function.name).toBe("read_file");
    expect(result.function.description).toBe("Read the contents of a file.");
    expect(result.function.parameters.type).toBe("object");
    expect(result.function.parameters.properties).toEqual({
      path: { type: "string", description: "File path" },
    });
    expect(result.function.parameters.required).toEqual(["path"]);
  });

  it("wraps tools in function envelope (OpenAI convention)", () => {
    const result = toOpenAiToolDef(SIMPLE_TOOL);
    expect(result.type).toBe("function");
    expect("function" in result).toBe(true);
  });

  it("uses parameters key (not input_schema)", () => {
    const result = toOpenAiToolDef(SIMPLE_TOOL);
    expect("parameters" in result.function).toBe(true);
    expect("input_schema" in result.function).toBe(false);
  });

  it("preserves enum constraints", () => {
    const result = toOpenAiToolDef(ENUM_TOOL);

    const statusProp = result.function.parameters.properties.status as Record<string, unknown>;
    expect(statusProp.enum).toEqual(["pending", "in_progress", "completed"]);
  });

  it("compiles nested object properties", () => {
    const result = toOpenAiToolDef(NESTED_OBJECT_TOOL);

    const optionsProp = result.function.parameters.properties.options as Record<string, unknown>;
    expect(optionsProp.type).toBe("object");
    expect(optionsProp.required).toEqual(["verbose"]);
  });

  it("compiles array properties with items", () => {
    const result = toOpenAiToolDef(ARRAY_PARAM_TOOL);

    const tagsProp = result.function.parameters.properties.tags as Record<string, unknown>;
    expect(tagsProp.type).toBe("array");
    expect(tagsProp.items).toEqual({ type: "string" });
  });

  it("does not mutate the original tool definition", () => {
    const result = toOpenAiToolDef(ENUM_TOOL);

    (result.function.parameters.properties.status as Record<string, unknown>).description = "changed";
    expect(ENUM_TOOL.inputSchema.properties.status.description).toBe("New status");
  });
});

// ── toOpenAiToolDefs (batch) ─────────────────────────────────────────────

describe("toOpenAiToolDefs", () => {
  it("compiles an array of tool definitions", () => {
    const results = toOpenAiToolDefs([SIMPLE_TOOL, MULTI_PARAM_TOOL]);

    expect(results).toHaveLength(2);
    expect(results[0].function.name).toBe("read_file");
    expect(results[1].function.name).toBe("write_file");
  });

  it("returns an empty array for empty input", () => {
    expect(toOpenAiToolDefs([])).toEqual([]);
  });
});

// ── Cross-vendor parity ──────────────────────────────────────────────────

describe("cross-vendor parity", () => {
  const ALL_TOOLS = [
    SIMPLE_TOOL,
    MULTI_PARAM_TOOL,
    ENUM_TOOL,
    OPTIONAL_PARAMS_TOOL,
    BOOLEAN_PARAM_TOOL,
    NESTED_OBJECT_TOOL,
    ARRAY_PARAM_TOOL,
  ];

  it("both vendors produce the same tool names", () => {
    const anthropicNames = toAnthropicToolDefs(ALL_TOOLS).map((t) => t.name);
    const openAiNames = toOpenAiToolDefs(ALL_TOOLS).map((t) => t.function.name);

    expect(anthropicNames).toEqual(openAiNames);
  });

  it("both vendors produce the same descriptions", () => {
    const anthropicDescs = toAnthropicToolDefs(ALL_TOOLS).map((t) => t.description);
    const openAiDescs = toOpenAiToolDefs(ALL_TOOLS).map((t) => t.function.description);

    expect(anthropicDescs).toEqual(openAiDescs);
  });

  it("both vendors produce the same required arrays", () => {
    const anthropicReq = toAnthropicToolDefs(ALL_TOOLS).map((t) => t.input_schema.required);
    const openAiReq = toOpenAiToolDefs(ALL_TOOLS).map((t) => t.function.parameters.required);

    expect(anthropicReq).toEqual(openAiReq);
  });

  it("both vendors produce equivalent property schemas", () => {
    for (const tool of ALL_TOOLS) {
      const anthropic = toAnthropicToolDef(tool);
      const openAi = toOpenAiToolDef(tool);

      expect(anthropic.input_schema.properties).toEqual(
        openAi.function.parameters.properties,
      );
    }
  });
});
