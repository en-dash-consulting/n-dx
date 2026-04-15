/**
 * Vendor-neutral tool schema definitions and compilation functions.
 *
 * This module defines a canonical tool schema that is independent of any
 * vendor SDK. Tool definitions are authored once in this neutral format
 * and compiled to vendor-specific shapes on demand:
 *
 * - {@link toAnthropicToolDef} → Anthropic SDK `Tool` shape
 * - {@link toOpenAiToolDef} → OpenAI SDK `ChatCompletionTool` shape
 *
 * ## Architectural role
 *
 * Lives in the foundation layer (`@n-dx/llm-client`). Consumed by:
 * - `hench` via `llm-gateway.ts` — tool definitions for the agent loop
 * - Future vendor providers — compile neutral schemas to native format
 *
 * No upstream imports — this module is self-contained.
 *
 * @see docs/architecture/phase2-vendor-normalization.md §4.3
 */

// ── JSON Schema subset ───────────────────────────────────────────────────

/**
 * Supported JSON Schema primitive types for tool parameters.
 */
export type JsonSchemaType = "string" | "number" | "integer" | "boolean" | "array" | "object";

/**
 * A single property within a tool parameter schema.
 *
 * Covers the JSON Schema subset actually used by LLM tool definitions:
 * primitives, enums, descriptions, and nested objects/arrays.
 */
export interface ToolPropertySchema {
  /** JSON Schema type of this property. */
  readonly type: JsonSchemaType;
  /** Human-readable description shown to the LLM. */
  readonly description?: string;
  /** Constrained set of allowed values (string enums). */
  readonly enum?: ReadonlyArray<string>;
  /** Nested properties (when type is "object"). */
  readonly properties?: Readonly<Record<string, ToolPropertySchema>>;
  /** Required property names (when type is "object"). */
  readonly required?: ReadonlyArray<string>;
  /** Item schema (when type is "array"). */
  readonly items?: ToolPropertySchema;
}

/**
 * JSON Schema for a tool's input parameters.
 *
 * Always an object schema at the top level — individual parameters are
 * described as properties within the object.
 */
export interface ToolInputSchema {
  /** Always "object" at the top level. */
  readonly type: "object";
  /** Parameter definitions keyed by parameter name. */
  readonly properties: Readonly<Record<string, ToolPropertySchema>>;
  /** Names of required parameters. */
  readonly required: ReadonlyArray<string>;
}

// ── Vendor-neutral tool definition ───────────────────────────────────────

/**
 * Vendor-neutral tool definition.
 *
 * This is the canonical format for defining tools available to an LLM agent.
 * All tool definitions should be authored in this format and compiled to
 * vendor-specific shapes using {@link toAnthropicToolDef} or
 * {@link toOpenAiToolDef}.
 *
 * The shape is deliberately minimal — it captures exactly the information
 * that every major LLM vendor requires for function calling:
 *
 * - A unique name (snake_case by convention)
 * - A natural-language description the LLM reads to decide when to use the tool
 * - A JSON Schema describing the tool's input parameters
 */
export interface ToolDefinition {
  /** Unique tool name (snake_case). Used for dispatch and logging. */
  readonly name: string;
  /** Human-readable description shown to the LLM. */
  readonly description: string;
  /** JSON Schema for the tool's input parameters. */
  readonly inputSchema: ToolInputSchema;
}

// ── Anthropic compilation ────────────────────────────────────────────────

/**
 * Anthropic SDK tool shape.
 *
 * Matches the `Tool` type from `@anthropic-ai/sdk`. Defined here so that
 * the compilation function does not require the Anthropic SDK at runtime —
 * callers in the hench package pass the compiled output to the SDK.
 */
export interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}

/**
 * Compile a vendor-neutral tool definition to the Anthropic SDK format.
 *
 * The Anthropic API expects `input_schema` (snake_case) with a JSON Schema
 * object. This function maps from the neutral `inputSchema` (camelCase)
 * to the vendor-specific shape.
 */
export function toAnthropicToolDef(tool: ToolDefinition): AnthropicToolDef {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: "object",
      properties: toMutableRecord(tool.inputSchema.properties),
      required: [...tool.inputSchema.required],
    },
  };
}

/**
 * Compile an array of vendor-neutral tool definitions to Anthropic format.
 */
export function toAnthropicToolDefs(tools: ReadonlyArray<ToolDefinition>): AnthropicToolDef[] {
  return tools.map(toAnthropicToolDef);
}

// ── OpenAI compilation ───────────────────────────────────────────────────

/**
 * OpenAI SDK tool shape.
 *
 * Matches the `ChatCompletionTool` type from `openai`. Defined here so
 * that the compilation function does not require the OpenAI SDK at runtime.
 */
export interface OpenAiToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

/**
 * Compile a vendor-neutral tool definition to the OpenAI SDK format.
 *
 * The OpenAI API expects tools wrapped in `{ type: "function", function: { ... } }`
 * with `parameters` (not `input_schema`) holding the JSON Schema object.
 */
export function toOpenAiToolDef(tool: ToolDefinition): OpenAiToolDef {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        properties: toMutableRecord(tool.inputSchema.properties),
        required: [...tool.inputSchema.required],
      },
    },
  };
}

/**
 * Compile an array of vendor-neutral tool definitions to OpenAI format.
 */
export function toOpenAiToolDefs(tools: ReadonlyArray<ToolDefinition>): OpenAiToolDef[] {
  return tools.map(toOpenAiToolDef);
}

// ── Internal helpers ─────────────────────────────────────────────────────

/**
 * Convert a readonly record to a mutable record for vendor SDK compatibility.
 *
 * Vendor SDKs expect mutable `Record<string, unknown>` — we store definitions
 * as `Readonly<Record<string, ToolPropertySchema>>` for type safety.
 */
function toMutableRecord(
  props: Readonly<Record<string, ToolPropertySchema>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    result[key] = toPlainSchema(value);
  }
  return result;
}

/**
 * Recursively convert a ToolPropertySchema to a plain JSON Schema object.
 *
 * Strips the readonly wrapper and produces a plain object that vendor SDKs
 * accept without type conflicts.
 */
function toPlainSchema(schema: ToolPropertySchema): Record<string, unknown> {
  const plain: Record<string, unknown> = { type: schema.type };

  if (schema.description !== undefined) {
    plain.description = schema.description;
  }
  if (schema.enum !== undefined) {
    plain.enum = [...schema.enum];
  }
  if (schema.properties !== undefined) {
    plain.properties = toMutableRecord(schema.properties);
  }
  if (schema.required !== undefined) {
    plain.required = [...schema.required];
  }
  if (schema.items !== undefined) {
    plain.items = toPlainSchema(schema.items);
  }

  return plain;
}
