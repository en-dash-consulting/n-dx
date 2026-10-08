/**
 * Registry of migrations, by id. Nothing reads it yet: the migrate command
 * does. Deleting a migration's folder means deleting its entry here.
 *
 * @module migrations/registry
 */

import { v1ToV2 } from "./v1-to-v2/index.js";

export const MIGRATIONS = [v1ToV2] as const;

export type RegisteredMigration = (typeof MIGRATIONS)[number];

export function findMigration(id: string): RegisteredMigration | undefined {
  return MIGRATIONS.find((m) => m.id === id);
}
