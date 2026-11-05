/**
 * The OAuth scopes an `auth: "oauth"` connection's sign-in needs, from the
 * `oauth` block of the server profile it names (server-profiles.ts).
 *
 * The profile's read scopes always; its write scopes too while the
 * connection may write: one of the profile's write tools has a policy other
 * than never, or tracker sync goes through this connection with a rule that
 * is not off. A connection with no profile, or a profile with no `oauth`
 * block, needs none, and the SDK asks for what the server advertises.
 *
 * Before the first sign-in the server's tool list is unknown, so a write
 * tool's policy is its override, else the default for its class: a tool
 * overridden to a read runs, any other asks. Only "never" on every write tool
 * keeps the write scopes off.
 *
 * See docs/architecture/sidecar-connections.md.
 */

import type { HttpConnectionConfig } from "../connections/connection-config.js";
import { defaultPolicy, TOOL_POLICIES, type ToolRunPolicy } from "../connections/tool-policy.js";
import { loadServerProfile, type ProfileOptions } from "./server-profiles.js";
import { loadTrackerSync } from "./sync-config.js";

type Json = Record<string, unknown>;

const asRecord = (value: unknown): Json | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined;

/** A write tool's policy from the connection's raw `tools` overrides, before the server lists it. */
function writeToolPolicy(override: unknown): ToolRunPolicy {
  const entry = asRecord(override);
  if ((TOOL_POLICIES as readonly unknown[]).includes(entry?.policy)) return entry!.policy as ToolRunPolicy;
  return defaultPolicy(entry?.class === "read" ? "read" : "write");
}

/** Whether tracker sync goes through `connection` with a rule that is not off. */
function syncWrites(projectDir: string, connection: string): boolean {
  const sync = loadTrackerSync(projectDir);
  if (!sync || "problems" in sync || sync.connection !== connection) return false;
  return Object.values(sync.rules).some((mode) => mode !== "off");
}

/** The scopes `config`'s sign-in needs, in the profile's order; empty when its profile names none. */
export function connectionOAuthScopes(projectDir: string, config: HttpConnectionConfig, options: ProfileOptions = {}): string[] {
  if (!config.profile) return [];
  const profile = loadServerProfile(config.profile, options);
  if ("problems" in profile || !profile.oauth) return [];
  const { readScopes, writeScopes, writeTools } = profile.oauth;
  const overrides = asRecord(config.tools);
  const writes = writeTools.some((tool) => writeToolPolicy(overrides?.[tool]) !== "never") || syncWrites(projectDir, config.id);
  return writes ? [...readScopes, ...writeScopes] : [...readScopes];
}
