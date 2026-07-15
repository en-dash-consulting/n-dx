/**
 * Built-in integration schema definitions.
 *
 * This module exports all built-in schemas and provides a
 * {@link registerBuiltInSchemas} function that registers them
 * with the integration schema registry.
 *
 * @module store/integration-schemas
 */

export { notionIntegrationSchema } from "./notion.js";
export { jiraIntegrationSchema } from "./jira.js";
export { asanaIntegrationSchema } from "./asana.js";
export { githubIntegrationSchema } from "./github.js";

import { registerIntegrationSchema, listIntegrationSchemas } from "../integration-schema.js";
import { notionIntegrationSchema } from "./notion.js";
import { jiraIntegrationSchema } from "./jira.js";
import { asanaIntegrationSchema } from "./asana.js";
import { githubIntegrationSchema } from "./github.js";

/** Whether built-in schemas have been registered. */
let registered = false;

/**
 * Register all built-in integration schemas.
 *
 * Safe to call multiple times — only registers on the first call.
 */
export function registerBuiltInSchemas(): void {
  if (registered) return;
  registered = true;

  registerIntegrationSchema(notionIntegrationSchema);
  registerIntegrationSchema(jiraIntegrationSchema);
  registerIntegrationSchema(asanaIntegrationSchema);
  registerIntegrationSchema(githubIntegrationSchema);
}

/**
 * Ensure built-in schemas are registered, then return the full list.
 *
 * Convenience wrapper for server routes that need the schema list.
 */
export function ensureSchemas() {
  registerBuiltInSchemas();
  return listIntegrationSchemas();
}

/**
 * Reset registration state (for testing only).
 * @internal
 */
export function resetRegistration(): void {
  registered = false;
}
