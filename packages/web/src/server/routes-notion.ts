/**
 * Notion integration configuration API routes.
 *
 * Manages Notion API credentials (token + database ID) through the
 * adapter registry, validates connection health, validates the database
 * schema, and provides configuration endpoints for the dashboard UI.
 *
 * Credentials are stored via the adapter registry's redaction mechanism:
 * sensitive fields (token) are replaced with `{ __redacted, envVar, hint }`
 * in `.rex/adapters.json`, and the real value must be provided via
 * environment variable at runtime.
 *
 * GET  /api/notion/config       — current Notion adapter config (masked)
 * PUT  /api/notion/config       — save/update Notion adapter config
 * POST /api/notion/test         — test connection to Notion API
 * POST /api/notion/schema       — validate database schema for PRD mapping
 * POST /api/notion/schema/fix   — create missing properties in database
 * DELETE /api/notion/config     — remove Notion adapter config
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse, readBody } from "./response-utils.js";

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Validate Notion API key format.
 *
 * Notion integration tokens start with `secret_` or `ntn_` and are
 * typically 50+ characters long.
 */
function validateApiKeyFormat(token: string): string | null {
  if (!token || token.trim().length === 0) {
    return "API key is required";
  }
  const trimmed = token.trim();
  if (!trimmed.startsWith("secret_") && !trimmed.startsWith("ntn_")) {
    return "API key must start with 'secret_' or 'ntn_'";
  }
  if (trimmed.length < 20) {
    return "API key appears too short";
  }
  return null;
}

/**
 * Validate Notion database ID format.
 *
 * Database IDs are UUIDs (with or without hyphens), 32 hex chars.
 */
function validateDatabaseIdFormat(id: string): string | null {
  if (!id || id.trim().length === 0) {
    return "Database ID is required";
  }
  const trimmed = id.trim().replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(trimmed)) {
    return "Database ID must be a valid UUID (32 hex characters)";
  }
  return null;
}

/**
 * Mask an API key for display: show first 8 and last 4 chars.
 */
function maskApiKey(token: string): string {
  if (token.length <= 12) return "****";
  return token.slice(0, 8) + "****" + token.slice(-4);
}

// ---------------------------------------------------------------------------
// Notion API test helper
// ---------------------------------------------------------------------------

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

interface ConnectionTestResult {
  status: "green" | "yellow" | "red";
  message: string;
  details?: {
    /** Whether the API key is valid (user can authenticate). */
    authValid: boolean;
    /** Whether the database is accessible. */
    databaseAccessible: boolean;
    /** Database title if accessible. */
    databaseTitle?: string;
    /** Number of pages in database (if accessible). */
    pageCount?: number;
  };
}

// ---------------------------------------------------------------------------
// Schema validation types
// ---------------------------------------------------------------------------

/**
 * Expected database properties for PRD mapping.
 *
 * Mirrors DATABASE_SCHEMA from rex's notion-map.ts. Defined here locally
 * to avoid a compile-time import (rex is dynamically imported only for
 * the adapter registry).
 */
const REQUIRED_PROPERTIES: Record<string, string> = {
  Name: "title",
  Status: "status",
  Level: "select",
  "PRD ID": "rich_text",
};

const OPTIONAL_PROPERTIES: Record<string, string> = {
  Description: "rich_text",
  Priority: "select",
  Tags: "multi_select",
  Source: "rich_text",
  "Blocked By": "rich_text",
  "Started At": "rich_text",
  "Completed At": "rich_text",
};

/** All expected properties (required + optional). */
const ALL_PROPERTIES: Record<string, string> = {
  ...REQUIRED_PROPERTIES,
  ...OPTIONAL_PROPERTIES,
};

/** Properties that can be created via the Notion API (Status cannot). */
const CREATABLE_TYPES = new Set(["rich_text", "select", "multi_select"]);

interface SchemaPropertyResult {
  name: string;
  expectedType: string;
  actualType: string | null;
  required: boolean;
  status: "ok" | "missing" | "wrong_type";
  /** Whether this property can be auto-created via the API. */
  canAutoCreate: boolean;
  /** Human-readable guidance for fixing the issue. */
  guidance?: string;
}

interface SchemaValidationResponse {
  valid: boolean;
  databaseTitle: string;
  properties: SchemaPropertyResult[];
  /** Summary counts for quick display. */
  summary: {
    total: number;
    ok: number;
    missing: number;
    wrongType: number;
    fixable: number;
  };
}

/**
 * Validate a Notion database's property schema against the expected
 * PRD property structure. Returns per-property diagnostics.
 */
async function validateNotionSchema(
  token: string,
  databaseId: string,
): Promise<SchemaValidationResponse | ConnectionTestResult> {
  // Fetch the database to inspect its properties
  let dbData: { title?: Array<{ plain_text?: string }>; properties?: Record<string, { type: string }> };

  try {
    const dbRes = await fetch(`${NOTION_API}/databases/${databaseId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
      },
    });

    if (!dbRes.ok) {
      if (dbRes.status === 401) {
        return {
          status: "red",
          message: "Invalid API key. Check your Notion integration token.",
          details: { authValid: false, databaseAccessible: false },
        };
      }
      if (dbRes.status === 404) {
        return {
          status: "red",
          message: "Database not found. Check the database ID and ensure your integration has access.",
          details: { authValid: true, databaseAccessible: false },
        };
      }
      const text = await dbRes.text().catch(() => "");
      return {
        status: "red",
        message: `Cannot access database (${dbRes.status}): ${text.slice(0, 200)}`,
        details: { authValid: true, databaseAccessible: false },
      };
    }

    dbData = await dbRes.json();
  } catch (err) {
    return {
      status: "red",
      message: `Cannot reach Notion API: ${err instanceof Error ? err.message : String(err)}`,
      details: { authValid: false, databaseAccessible: false },
    };
  }

  const databaseTitle = dbData.title?.[0]?.plain_text ?? "Untitled";
  const dbProps = dbData.properties ?? {};

  const properties: SchemaPropertyResult[] = [];
  let ok = 0;
  let missing = 0;
  let wrongType = 0;
  let fixable = 0;

  for (const [name, expectedType] of Object.entries(ALL_PROPERTIES)) {
    const isRequired = name in REQUIRED_PROPERTIES;
    const dbProp = dbProps[name];

    if (!dbProp) {
      const canAutoCreate = CREATABLE_TYPES.has(expectedType);
      let guidance: string;
      if (expectedType === "status") {
        guidance = "The Status property must be created manually in Notion. Open your database, click + to add a property, and select \"Status\" as the type.";
      } else if (expectedType === "title") {
        guidance = "Every Notion database has a Title property. It may have been renamed. Ensure a property named \"Name\" exists with type \"Title\".";
      } else if (canAutoCreate) {
        guidance = "This property can be created automatically using the \"Fix Missing Properties\" button.";
      } else {
        guidance = `Add a property named "${name}" with type "${expectedType}" in your Notion database.`;
      }

      properties.push({
        name,
        expectedType,
        actualType: null,
        required: isRequired,
        status: "missing",
        canAutoCreate,
        guidance,
      });
      missing++;
      if (canAutoCreate) fixable++;
    } else if (dbProp.type !== expectedType) {
      properties.push({
        name,
        expectedType,
        actualType: dbProp.type,
        required: isRequired,
        status: "wrong_type",
        canAutoCreate: false,
        guidance: `Property "${name}" has type "${dbProp.type}" but should be "${expectedType}". Delete the property and recreate it with the correct type in Notion.`,
      });
      wrongType++;
    } else {
      properties.push({
        name,
        expectedType,
        actualType: dbProp.type,
        required: isRequired,
        status: "ok",
        canAutoCreate: false,
      });
      ok++;
    }
  }

  // Sort: required first, then by status (missing → wrong_type → ok), then by name
  const statusOrder = { missing: 0, wrong_type: 1, ok: 2 };
  properties.sort((a, b) => {
    if (a.required !== b.required) return a.required ? -1 : 1;
    const sa = statusOrder[a.status];
    const sb = statusOrder[b.status];
    if (sa !== sb) return sa - sb;
    return a.name.localeCompare(b.name);
  });

  const valid = properties
    .filter((p) => p.required)
    .every((p) => p.status === "ok");

  return {
    valid,
    databaseTitle,
    properties,
    summary: {
      total: properties.length,
      ok,
      missing,
      wrongType,
      fixable,
    },
  };
}

/**
 * Create missing properties in the Notion database.
 *
 * Only creates properties whose type is in CREATABLE_TYPES.
 * Status and Title properties cannot be created via the API.
 */
async function createMissingProperties(
  token: string,
  databaseId: string,
  propertyNames: string[],
): Promise<{ created: string[]; failed: Array<{ name: string; error: string }> }> {
  const created: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];

  // Build a single update payload with all properties to create
  const propertiesToCreate: Record<string, unknown> = {};

  for (const name of propertyNames) {
    const expectedType = ALL_PROPERTIES[name];
    if (!expectedType) {
      failed.push({ name, error: `Unknown property "${name}"` });
      continue;
    }
    if (!CREATABLE_TYPES.has(expectedType)) {
      failed.push({
        name,
        error: `Property type "${expectedType}" cannot be created via the API. Create it manually in Notion.`,
      });
      continue;
    }

    // Build the property schema for the Notion API
    if (expectedType === "rich_text") {
      propertiesToCreate[name] = { rich_text: {} };
    } else if (expectedType === "select") {
      // Pre-populate select options where applicable
      if (name === "Level") {
        propertiesToCreate[name] = {
          select: {
            options: [
              { name: "epic", color: "purple" },
              { name: "feature", color: "blue" },
              { name: "task", color: "green" },
              { name: "subtask", color: "gray" },
            ],
          },
        };
      } else if (name === "Priority") {
        propertiesToCreate[name] = {
          select: {
            options: [
              { name: "Critical", color: "red" },
              { name: "High", color: "orange" },
              { name: "Medium", color: "yellow" },
              { name: "Low", color: "gray" },
            ],
          },
        };
      } else {
        propertiesToCreate[name] = { select: {} };
      }
    } else if (expectedType === "multi_select") {
      propertiesToCreate[name] = { multi_select: {} };
    }
  }

  if (Object.keys(propertiesToCreate).length === 0) {
    return { created, failed };
  }

  try {
    const updateRes = await fetch(`${NOTION_API}/databases/${databaseId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ properties: propertiesToCreate }),
    });

    if (!updateRes.ok) {
      const text = await updateRes.text().catch(() => "");
      // All properties failed
      for (const name of Object.keys(propertiesToCreate)) {
        failed.push({
          name,
          error: `Notion API error (${updateRes.status}): ${text.slice(0, 200)}`,
        });
      }
    } else {
      created.push(...Object.keys(propertiesToCreate));
    }
  } catch (err) {
    for (const name of Object.keys(propertiesToCreate)) {
      failed.push({
        name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { created, failed };
}

async function testNotionConnection(
  token: string,
  databaseId: string,
): Promise<ConnectionTestResult> {
  // Step 1: Test API key validity by fetching the bot user
  try {
    const userRes = await fetch(`${NOTION_API}/users/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
      },
    });

    if (!userRes.ok) {
      const text = await userRes.text().catch(() => "");
      if (userRes.status === 401) {
        return {
          status: "red",
          message: "Invalid API key. Check your Notion integration token.",
          details: { authValid: false, databaseAccessible: false },
        };
      }
      return {
        status: "red",
        message: `Notion API error (${userRes.status}): ${text.slice(0, 200)}`,
        details: { authValid: false, databaseAccessible: false },
      };
    }
  } catch (err) {
    return {
      status: "red",
      message: `Cannot reach Notion API: ${err instanceof Error ? err.message : String(err)}`,
      details: { authValid: false, databaseAccessible: false },
    };
  }

  // Step 2: Test database access
  try {
    const dbRes = await fetch(`${NOTION_API}/databases/${databaseId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
      },
    });

    if (!dbRes.ok) {
      if (dbRes.status === 404) {
        return {
          status: "yellow",
          message: "API key is valid, but the database was not found. Check the database ID and ensure your integration has access.",
          details: { authValid: true, databaseAccessible: false },
        };
      }
      const text = await dbRes.text().catch(() => "");
      return {
        status: "yellow",
        message: `API key is valid, but database access failed (${dbRes.status}): ${text.slice(0, 200)}`,
        details: { authValid: true, databaseAccessible: false },
      };
    }

    const db = await dbRes.json() as { title?: Array<{ plain_text?: string }>; id: string };
    const dbTitle = db.title?.[0]?.plain_text ?? "Untitled";

    // Step 3: Quick query to verify read access and get page count
    let pageCount = 0;
    try {
      const queryRes = await fetch(`${NOTION_API}/databases/${databaseId}/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ page_size: 1 }),
      });
      if (queryRes.ok) {
        const queryData = await queryRes.json() as { results?: unknown[] };
        pageCount = queryData.results?.length ?? 0;
      }
    } catch {
      // Non-fatal: we already confirmed database access
    }

    return {
      status: "green",
      message: `Connected to "${dbTitle}"`,
      details: {
        authValid: true,
        databaseAccessible: true,
        databaseTitle: dbTitle,
        pageCount,
      },
    };
  } catch (err) {
    return {
      status: "yellow",
      message: `API key is valid, but database check failed: ${err instanceof Error ? err.message : String(err)}`,
      details: { authValid: true, databaseAccessible: false },
    };
  }
}

// ---------------------------------------------------------------------------
// Adapter registry interaction (dynamic import to avoid coupling)
// ---------------------------------------------------------------------------

/**
 * Dynamically load the adapter registry from the rex package.
 *
 * This avoids a hard compile-time dependency on rex from the web package.
 * The web package's gateway (domain-gateway.ts) handles MCP server factories;
 * for adapter config we use a lightweight dynamic import.
 */
async function loadRegistry(): Promise<{
  getDefaultRegistry: () => {
    getAdapterConfig: (rexDir: string, name: string) => Promise<{ name: string; config: Record<string, unknown> } | null>;
    saveAdapterConfig: (rexDir: string, entry: { name: string; config: Record<string, unknown> }) => Promise<void>;
    removeAdapterConfig: (rexDir: string, name: string) => Promise<void>;
  };
  isRedactedField: (v: unknown) => v is { __redacted: true; envVar: string; hint: string };
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = await import("@n-dx/rex/dist/store/adapter-registry.js") as any;
  return mod;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/** Handle Notion config API requests. Returns true if the request was handled. */
export async function handleNotionRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  const url = req.url || "/";
  const method = req.method || "GET";

  // Only handle /api/notion/* routes
  if (!url.startsWith("/api/notion/")) return false;

  // Check .rex/ exists
  if (!existsSync(ctx.rexDir)) {
    errorResponse(res, 404, "No .rex/ directory found. Run 'rex init' first.");
    return true;
  }

  // ── GET /api/notion/config ──────────────────────────────────────────

  if (method === "GET" && url === "/api/notion/config") {
    try {
      const { getDefaultRegistry, isRedactedField } = await loadRegistry();
      const registry = getDefaultRegistry();
      const adapterConfig = await registry.getAdapterConfig(ctx.rexDir, "notion");

      if (!adapterConfig) {
        jsonResponse(res, 200, {
          configured: false,
          token: null,
          databaseId: null,
          tokenMasked: null,
          tokenEnvVar: null,
        });
        return true;
      }

      // Extract config, masking sensitive fields
      const config = adapterConfig.config;
      let tokenMasked: string | null = null;
      let tokenEnvVar: string | null = null;
      let databaseId: string | null = null;

      if (isRedactedField(config.token)) {
        tokenMasked = config.token.hint;
        tokenEnvVar = config.token.envVar;
      } else if (typeof config.token === "string") {
        tokenMasked = maskApiKey(config.token);
      }

      if (typeof config.databaseId === "string") {
        databaseId = config.databaseId;
      }

      jsonResponse(res, 200, {
        configured: true,
        token: null, // Never expose raw token
        databaseId,
        tokenMasked,
        tokenEnvVar,
      });
    } catch (err) {
      errorResponse(res, 500, err instanceof Error ? err.message : "Failed to load config");
    }
    return true;
  }

  // ── PUT /api/notion/config ──────────────────────────────────────────

  if (method === "PUT" && url === "/api/notion/config") {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body) as { token?: string; databaseId?: string };

      // Validate fields
      const errors: Record<string, string> = {};

      if (data.token !== undefined) {
        const tokenErr = validateApiKeyFormat(data.token);
        if (tokenErr) errors.token = tokenErr;
      }

      if (data.databaseId !== undefined) {
        const dbErr = validateDatabaseIdFormat(data.databaseId);
        if (dbErr) errors.databaseId = dbErr;
      }

      if (Object.keys(errors).length > 0) {
        jsonResponse(res, 400, { error: "Validation failed", errors });
        return true;
      }

      // Load existing config and merge
      const { getDefaultRegistry } = await loadRegistry();
      const registry = getDefaultRegistry();
      const existing = await registry.getAdapterConfig(ctx.rexDir, "notion");
      const existingConfig = existing?.config ?? {};

      const newConfig: Record<string, unknown> = { ...existingConfig };
      if (data.token !== undefined) newConfig.token = data.token.trim();
      if (data.databaseId !== undefined) newConfig.databaseId = data.databaseId.trim().replace(/-/g, "");

      // Save via adapter registry (handles redaction automatically)
      await registry.saveAdapterConfig(ctx.rexDir, {
        name: "notion",
        config: newConfig as Record<string, unknown>,
      });

      jsonResponse(res, 200, {
        saved: true,
        tokenMasked: typeof newConfig.token === "string" ? maskApiKey(newConfig.token) : null,
        databaseId: newConfig.databaseId ?? null,
      });
    } catch (err) {
      errorResponse(res, 500, err instanceof Error ? err.message : "Failed to save config");
    }
    return true;
  }

  // ── DELETE /api/notion/config ───────────────────────────────────────

  if (method === "DELETE" && url === "/api/notion/config") {
    try {
      const { getDefaultRegistry } = await loadRegistry();
      const registry = getDefaultRegistry();
      await registry.removeAdapterConfig(ctx.rexDir, "notion");

      jsonResponse(res, 200, { removed: true });
    } catch (err) {
      errorResponse(res, 500, err instanceof Error ? err.message : "Failed to remove config");
    }
    return true;
  }

  // ── POST /api/notion/test ───────────────────────────────────────────

  if (method === "POST" && url === "/api/notion/test") {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body) as { token?: string; databaseId?: string };

      // If no token provided, try to use the stored one
      let token = data.token?.trim();
      let databaseId = data.databaseId?.trim();

      if (!token || !databaseId) {
        // Try to load from config + env
        const { getDefaultRegistry, isRedactedField } = await loadRegistry();
        const registry = getDefaultRegistry();
        const existing = await registry.getAdapterConfig(ctx.rexDir, "notion");

        if (existing) {
          if (!token) {
            const storedToken = existing.config.token;
            if (isRedactedField(storedToken)) {
              const envVal = process.env[storedToken.envVar];
              if (envVal) token = envVal;
            } else if (typeof storedToken === "string") {
              token = storedToken;
            }
          }
          if (!databaseId && typeof existing.config.databaseId === "string") {
            databaseId = existing.config.databaseId;
          }
        }
      }

      if (!token) {
        jsonResponse(res, 200, {
          status: "red",
          message: "No API key provided or configured. Enter a token to test.",
          details: { authValid: false, databaseAccessible: false },
        } satisfies ConnectionTestResult);
        return true;
      }

      if (!databaseId) {
        jsonResponse(res, 200, {
          status: "red",
          message: "No database ID provided or configured.",
          details: { authValid: false, databaseAccessible: false },
        } satisfies ConnectionTestResult);
        return true;
      }

      const result = await testNotionConnection(token, databaseId);
      jsonResponse(res, 200, result);
    } catch (err) {
      errorResponse(res, 500, err instanceof Error ? err.message : "Test failed");
    }
    return true;
  }

  // ── POST /api/notion/schema ─────────────────────────────────────────

  if (method === "POST" && url === "/api/notion/schema") {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body) as { token?: string; databaseId?: string };

      // Resolve credentials (same pattern as /test)
      let token = data.token?.trim();
      let databaseId = data.databaseId?.trim();

      if (!token || !databaseId) {
        const { getDefaultRegistry, isRedactedField } = await loadRegistry();
        const registry = getDefaultRegistry();
        const existing = await registry.getAdapterConfig(ctx.rexDir, "notion");

        if (existing) {
          if (!token) {
            const storedToken = existing.config.token;
            if (isRedactedField(storedToken)) {
              const envVal = process.env[storedToken.envVar];
              if (envVal) token = envVal;
            } else if (typeof storedToken === "string") {
              token = storedToken;
            }
          }
          if (!databaseId && typeof existing.config.databaseId === "string") {
            databaseId = existing.config.databaseId;
          }
        }
      }

      if (!token) {
        jsonResponse(res, 200, {
          status: "red",
          message: "No API key provided or configured. Save credentials first.",
          details: { authValid: false, databaseAccessible: false },
        } satisfies ConnectionTestResult);
        return true;
      }

      if (!databaseId) {
        jsonResponse(res, 200, {
          status: "red",
          message: "No database ID provided or configured.",
          details: { authValid: false, databaseAccessible: false },
        } satisfies ConnectionTestResult);
        return true;
      }

      const result = await validateNotionSchema(token, databaseId);
      jsonResponse(res, 200, result);
    } catch (err) {
      errorResponse(res, 500, err instanceof Error ? err.message : "Schema validation failed");
    }
    return true;
  }

  // ── POST /api/notion/schema/fix ─────────────────────────────────────

  if (method === "POST" && url === "/api/notion/schema/fix") {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body) as {
        token?: string;
        databaseId?: string;
        properties?: string[];
      };

      // Validate properties input before resolving credentials
      const propertyNames = data.properties;
      if (!propertyNames || propertyNames.length === 0) {
        errorResponse(res, 400, "No properties specified to create.");
        return true;
      }

      // Resolve credentials
      let token = data.token?.trim();
      let databaseId = data.databaseId?.trim();

      if (!token || !databaseId) {
        const { getDefaultRegistry, isRedactedField } = await loadRegistry();
        const registry = getDefaultRegistry();
        const existing = await registry.getAdapterConfig(ctx.rexDir, "notion");

        if (existing) {
          if (!token) {
            const storedToken = existing.config.token;
            if (isRedactedField(storedToken)) {
              const envVal = process.env[storedToken.envVar];
              if (envVal) token = envVal;
            } else if (typeof storedToken === "string") {
              token = storedToken;
            }
          }
          if (!databaseId && typeof existing.config.databaseId === "string") {
            databaseId = existing.config.databaseId;
          }
        }
      }

      if (!token || !databaseId) {
        errorResponse(res, 400, "Credentials not configured. Save token and database ID first.");
        return true;
      }

      const result = await createMissingProperties(token, databaseId, propertyNames);
      jsonResponse(res, 200, result);
    } catch (err) {
      errorResponse(res, 500, err instanceof Error ? err.message : "Property creation failed");
    }
    return true;
  }

  return false;
}
