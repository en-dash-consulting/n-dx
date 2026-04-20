/**
 * Schema version migrations for viewer loader data.
 * Ensures older output formats can be rendered by newer viewers.
 */

import type { LoadedData } from "../../types.js";

/** Current schema version. Inlined to avoid runtime import from schema/. */
const SCHEMA_VERSION = "1.0.0";

type ModuleKey = keyof LoadedData;

interface Migration {
  from: string;
  to: string;
  migrate: (data: unknown) => unknown;
}

const migrations: Record<ModuleKey, Migration[]> = {
  manifest: [],
  inventory: [],
  imports: [],
  zones: [],
  components: [],
  callGraph: [],
};

/**
 * Apply any needed migrations to bring data up to the current schema version.
 * Returns the migrated data (or the original if no migrations needed).
 */
export function migrateData(module: string, data: unknown): unknown {
  if (!data || typeof data !== "object") return data;

  const record = data as Record<string, unknown> & object;
  const dataVersion =
    module === "manifest"
      ? (record.schemaVersion as string | undefined)
      : undefined;

  if (dataVersion === SCHEMA_VERSION) return data;

  const moduleMigrations = migrations[module as ModuleKey];
  if (!moduleMigrations?.length) return data;

  let current: unknown = data;
  let currentVersion = dataVersion || "0.0.0";

  for (const migration of moduleMigrations) {
    if (currentVersion === migration.from) {
      current = migration.migrate(current);
      currentVersion = migration.to;
    }
  }

  return current;
}

/**
 * Register a migration for a module.
 * Used for future schema updates.
 */
export function registerMigration(
  module: ModuleKey,
  from: string,
  to: string,
  migrate: (data: unknown) => unknown
): void {
  migrations[module].push({ from, to, migrate });
}
