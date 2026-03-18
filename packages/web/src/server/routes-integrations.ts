/**
 * Generic integration configuration API routes.
 *
 * Provides schema-driven endpoints for listing available integrations,
 * retrieving their configuration schemas, and managing adapter configs.
 * This complements the existing Notion-specific routes by offering a
 * generic interface that works for any registered integration.
 *
 * GET  /api/integrations                — list all integration schemas
 * GET  /api/integrations/:id/schema     — get schema for one integration
 * GET  /api/integrations/:id/config     — get saved config (masked)
 * PUT  /api/integrations/:id/config     — save/update config
 * DELETE /api/integrations/:id/config   — remove config
 *
 * @module web/server/routes-integrations
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse, readBody } from "./types.js";

// ---------------------------------------------------------------------------
// Dynamic imports (avoid compile-time coupling to rex)
// ---------------------------------------------------------------------------

/**
 * Dynamically load the integration schema system from rex.
 *
 * Uses the same lightweight dynamic import pattern as routes-notion.ts.
 */
async function loadIntegrationSchemas(): Promise<{
  ensureSchemas: () => Array<{
    id: string;
    name: string;
    description: string;
    icon?: string;
    docsUrl?: string;
    setupGuide?: string[];
    fields: Record<string, {
      required: boolean;
      description: string;
      sensitive?: boolean;
      label?: string;
      inputType?: string;
      placeholder?: string;
      helpText?: string;
      docUrl?: string;
      docLabel?: string;
      defaultValue?: string | number | boolean;
      validationRules?: Array<{
        type: string;
        pattern?: string;
        minLength?: number;
        maxLength?: number;
        min?: number;
        max?: number;
        validator?: string;
        message: string;
      }>;
      options?: Array<{ label: string; value: string; description?: string }>;
      group?: string;
      order?: number;
    }>;
    groups?: Record<string, {
      label: string;
      icon?: string;
      order?: number;
      description?: string;
    }>;
    supportsConnectionTest?: boolean;
    supportsSchemaValidation?: boolean;
    builtIn?: boolean;
  }>;
  getIntegrationSchema: (id: string) => {
    id: string;
    name: string;
    fields: Record<string, { required: boolean; description: string; sensitive?: boolean; validationRules?: Array<{ type: string; pattern?: string; minLength?: number; maxLength?: number; message: string }> }>;
    [key: string]: unknown;
  } | undefined;
  validateConfig: (config: Record<string, unknown>, schema: { fields: Record<string, unknown>; [key: string]: unknown }) => Record<string, { valid: boolean; error?: string }>;
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = await import("@n-dx/rex/dist/store/integration-schema.js") as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schemas = await import("@n-dx/rex/dist/store/integration-schemas/index.js") as any;
  return {
    ensureSchemas: schemas.ensureSchemas,
    getIntegrationSchema: mod.getIntegrationSchema,
    validateConfig: mod.validateConfig,
  };
}

/**
 * Load the adapter registry (same as routes-notion.ts).
 */
async function loadRegistry(): Promise<{
  getDefaultRegistry: () => {
    getAdapterConfig: (rexDir: string, name: string) => Promise<{ name: string; config: Record<string, unknown> } | null>;
    saveAdapterConfig: (rexDir: string, entry: { name: string; config: Record<string, unknown> }) => Promise<void>;
    removeAdapterConfig: (rexDir: string, name: string) => Promise<void>;
    list: () => Array<{ name: string; description: string; builtIn: boolean; configSchema: Record<string, unknown> }>;
  };
  isRedactedField: (v: unknown) => v is { __redacted: true; envVar: string; hint: string };
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = await import("@n-dx/rex/dist/store/adapter-registry.js") as any;
  return mod;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mask a sensitive string for display: show first 4 and last 4 chars.
 */
function maskSensitive(value: string): string {
  if (value.length <= 8) return "****";
  return value.slice(0, 4) + "****" + value.slice(-4);
}

/**
 * Extract integration ID from URL path.
 * Matches: /api/integrations/<id>/schema, /api/integrations/<id>/config
 */
function parseIntegrationPath(url: string): { id: string; action: string } | null {
  const match = url.match(/^\/api\/integrations\/([a-zA-Z0-9_-]+)\/(schema|config)$/);
  if (!match) return null;
  return { id: match[1], action: match[2] };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * Handle generic integration API requests.
 * Returns true if the request was handled.
 */
export async function handleIntegrationRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  const url = req.url || "/";
  const method = req.method || "GET";

  // Only handle /api/integrations/* routes
  if (!url.startsWith("/api/integrations")) return false;

  // ── GET /api/integrations ────────────────────────────────────────────
  // List all available integration schemas

  if (method === "GET" && url === "/api/integrations") {
    try {
      const { ensureSchemas } = await loadIntegrationSchemas();
      const schemas = ensureSchemas();

      // Strip sensitive defaults and return schemas
      const sanitized = schemas.map((s) => ({
        ...s,
        fields: Object.fromEntries(
          Object.entries(s.fields).map(([key, field]) => [
            key,
            {
              ...field,
              // Never send sensitive default values to the client
              defaultValue: field.sensitive ? undefined : field.defaultValue,
            },
          ]),
        ),
      }));

      jsonResponse(res, 200, { integrations: sanitized });
    } catch (err) {
      errorResponse(res, 500, err instanceof Error ? err.message : "Failed to list integrations");
    }
    return true;
  }

  // Parse integration-specific paths
  const parsed = parseIntegrationPath(url);
  if (!parsed) return false;

  const { id, action } = parsed;

  // ── GET /api/integrations/:id/schema ─────────────────────────────────
  // Get full schema for a specific integration

  if (method === "GET" && action === "schema") {
    try {
      const { ensureSchemas, getIntegrationSchema } = await loadIntegrationSchemas();
      ensureSchemas();
      const schema = getIntegrationSchema(id);

      if (!schema) {
        errorResponse(res, 404, `Integration "${id}" not found`);
        return true;
      }

      jsonResponse(res, 200, schema);
    } catch (err) {
      errorResponse(res, 500, err instanceof Error ? err.message : "Failed to get schema");
    }
    return true;
  }

  // Check .rex/ exists for config operations
  if (action === "config" && !existsSync(ctx.rexDir)) {
    errorResponse(res, 404, "No .rex/ directory found. Run 'rex init' first.");
    return true;
  }

  // ── GET /api/integrations/:id/config ─────────────────────────────────
  // Get saved config for a specific integration (with masking)

  if (method === "GET" && action === "config") {
    try {
      const { getDefaultRegistry, isRedactedField } = await loadRegistry();
      const { ensureSchemas, getIntegrationSchema } = await loadIntegrationSchemas();
      ensureSchemas();

      const schema = getIntegrationSchema(id);
      if (!schema) {
        errorResponse(res, 404, `Integration "${id}" not found`);
        return true;
      }

      const registry = getDefaultRegistry();
      const adapterConfig = await registry.getAdapterConfig(ctx.rexDir, id);

      if (!adapterConfig) {
        jsonResponse(res, 200, {
          configured: false,
          integration: id,
          values: {},
          masked: {},
          envVars: {},
        });
        return true;
      }

      // Build masked response
      const values: Record<string, unknown> = {};
      const masked: Record<string, string> = {};
      const envVars: Record<string, string> = {};

      for (const [key, val] of Object.entries(adapterConfig.config)) {
        const fieldSchema = schema.fields[key];
        if (isRedactedField(val)) {
          masked[key] = val.hint;
          envVars[key] = val.envVar;
          // Don't include raw value
        } else if (fieldSchema?.sensitive && typeof val === "string") {
          masked[key] = maskSensitive(val);
          // Don't include raw value
        } else {
          values[key] = val;
        }
      }

      jsonResponse(res, 200, {
        configured: true,
        integration: id,
        values,
        masked,
        envVars,
      });
    } catch (err) {
      errorResponse(res, 500, err instanceof Error ? err.message : "Failed to load config");
    }
    return true;
  }

  // ── PUT /api/integrations/:id/config ─────────────────────────────────
  // Save/update config for a specific integration

  if (method === "PUT" && action === "config") {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body) as Record<string, unknown>;

      const { ensureSchemas, getIntegrationSchema, validateConfig } = await loadIntegrationSchemas();
      ensureSchemas();

      const schema = getIntegrationSchema(id);
      if (!schema) {
        errorResponse(res, 404, `Integration "${id}" not found`);
        return true;
      }

      // Validate provided fields against schema rules
      // Only validate fields that are actually provided
      const providedFields: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(data)) {
        if (key in schema.fields && val !== undefined && val !== "") {
          providedFields[key] = val;
        }
      }

      if (Object.keys(providedFields).length === 0) {
        errorResponse(res, 400, "No valid fields provided");
        return true;
      }

      // Validate the provided values
      const errors = validateConfig(providedFields, schema as Parameters<typeof validateConfig>[1]);
      if (Object.keys(errors).length > 0) {
        jsonResponse(res, 400, {
          error: "Validation failed",
          errors: Object.fromEntries(
            Object.entries(errors).map(([k, v]) => [k, (v as { error?: string }).error]),
          ),
        });
        return true;
      }

      // Load existing config and merge
      const { getDefaultRegistry } = await loadRegistry();
      const registry = getDefaultRegistry();
      const existing = await registry.getAdapterConfig(ctx.rexDir, id);
      const existingConfig = existing?.config ?? {};

      const newConfig: Record<string, unknown> = { ...existingConfig };
      for (const [key, val] of Object.entries(providedFields)) {
        if (typeof val === "string") {
          newConfig[key] = val.trim();
        } else {
          newConfig[key] = val;
        }
      }

      // Save via adapter registry (handles redaction automatically)
      await registry.saveAdapterConfig(ctx.rexDir, {
        name: id,
        config: newConfig,
      });

      // Build masked response
      const maskedResponse: Record<string, string> = {};
      for (const [key, val] of Object.entries(newConfig)) {
        const fieldSchema = schema.fields[key];
        if (fieldSchema?.sensitive && typeof val === "string") {
          maskedResponse[key] = maskSensitive(val);
        }
      }

      jsonResponse(res, 200, {
        saved: true,
        integration: id,
        masked: maskedResponse,
      });
    } catch (err) {
      errorResponse(res, 500, err instanceof Error ? err.message : "Failed to save config");
    }
    return true;
  }

  // ── DELETE /api/integrations/:id/config ──────────────────────────────
  // Remove config for a specific integration

  if (method === "DELETE" && action === "config") {
    try {
      const { getDefaultRegistry } = await loadRegistry();
      const registry = getDefaultRegistry();
      await registry.removeAdapterConfig(ctx.rexDir, id);

      jsonResponse(res, 200, { removed: true, integration: id });
    } catch (err) {
      errorResponse(res, 500, err instanceof Error ? err.message : "Failed to remove config");
    }
    return true;
  }

  return false;
}
